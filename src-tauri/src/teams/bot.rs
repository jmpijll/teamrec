use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Serialize, Clone, Debug)]
pub struct TeamInfo {
    pub id: String,
    pub name: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct ChannelInfo {
    pub id: String,
    pub name: String,
    pub team_id: String,
}

#[derive(Deserialize)]
struct GraphTeamsResponse {
    value: Vec<GraphTeam>,
}

#[derive(Deserialize)]
struct GraphTeam {
    id: String,
    #[serde(rename = "displayName")]
    display_name: String,
}

#[derive(Deserialize)]
struct GraphChannelsResponse {
    value: Vec<GraphChannel>,
}

#[derive(Deserialize)]
struct GraphChannel {
    id: String,
    #[serde(rename = "displayName")]
    display_name: String,
    #[serde(rename = "membershipType")]
    membership_type: Option<String>,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
}

struct AuthState {
    access_token: String,
    client_id: String,
    tenant_id: String,
    client_secret: String,
}

pub struct TeamsBot {
    auth: Arc<RwLock<Option<AuthState>>>,
    ready_flag: Arc<AtomicBool>,
    http: reqwest::Client,
}

impl TeamsBot {
    pub fn new() -> Self {
        Self {
            auth: Arc::new(RwLock::new(None)),
            ready_flag: Arc::new(AtomicBool::new(false)),
            http: reqwest::Client::new(),
        }
    }

    pub fn is_connected(&self) -> bool {
        self.ready_flag.load(Ordering::SeqCst)
    }

    pub async fn connect(
        &mut self,
        client_id: &str,
        tenant_id: &str,
        client_secret: &str,
    ) -> Result<()> {
        if self.is_connected() {
            anyhow::bail!("Already connected to Microsoft Teams");
        }

        self.ready_flag.store(false, Ordering::SeqCst);

        // Authenticate via OAuth2 client credentials flow
        let token_url = format!(
            "https://login.microsoftonline.com/{}/oauth2/v2.0/token",
            tenant_id
        );

        let params = [
            ("grant_type", "client_credentials"),
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("scope", "https://graph.microsoft.com/.default"),
        ];

        let resp = self
            .http
            .post(&token_url)
            .form(&params)
            .send()
            .await
            .context("Failed to connect to Azure AD")?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!(
                "Authentication failed ({}): {}",
                status,
                body
            );
        }

        let token_resp: TokenResponse = resp
            .json()
            .await
            .context("Failed to parse token response")?;

        let auth_state = AuthState {
            access_token: token_resp.access_token,
            client_id: client_id.to_string(),
            tenant_id: tenant_id.to_string(),
            client_secret: client_secret.to_string(),
        };

        *self.auth.write().await = Some(auth_state);
        self.ready_flag.store(true, Ordering::SeqCst);

        log::info!("Teams bot connected via Microsoft Graph API");
        Ok(())
    }

    pub async fn disconnect(&mut self) {
        self.ready_flag.store(false, Ordering::SeqCst);
        *self.auth.write().await = None;
        log::info!("Teams bot disconnected");
    }

    async fn get_token(&self) -> Result<String> {
        let auth = self.auth.read().await;
        let auth = auth.as_ref().context("Not connected to Microsoft Teams")?;
        Ok(auth.access_token.clone())
    }

    /// Refresh the access token using stored credentials
    pub async fn refresh_token(&self) -> Result<()> {
        let (client_id, tenant_id, client_secret) = {
            let auth = self.auth.read().await;
            let auth = auth.as_ref().context("Not connected to Microsoft Teams")?;
            (
                auth.client_id.clone(),
                auth.tenant_id.clone(),
                auth.client_secret.clone(),
            )
        };

        let token_url = format!(
            "https://login.microsoftonline.com/{}/oauth2/v2.0/token",
            tenant_id
        );

        let params = [
            ("grant_type", "client_credentials"),
            ("client_id", client_id.as_str()),
            ("client_secret", client_secret.as_str()),
            ("scope", "https://graph.microsoft.com/.default"),
        ];

        let resp = self
            .http
            .post(&token_url)
            .form(&params)
            .send()
            .await
            .context("Failed to refresh token")?;

        if !resp.status().is_success() {
            anyhow::bail!("Token refresh failed: {}", resp.status());
        }

        let token_resp: TokenResponse = resp.json().await?;

        let mut auth = self.auth.write().await;
        if let Some(ref mut a) = *auth {
            a.access_token = token_resp.access_token;
        }

        log::info!("Access token refreshed");
        Ok(())
    }

    pub async fn list_teams(&self) -> Result<Vec<TeamInfo>> {
        let token = self.get_token().await?;

        let resp = self
            .http
            .get("https://graph.microsoft.com/v1.0/groups?$filter=resourceProvisioningOptions/Any(x:x eq 'Team')&$select=id,displayName")
            .bearer_auth(&token)
            .send()
            .await
            .context("Failed to list teams")?;

        if !resp.status().is_success() {
            let status = resp.status();
            // Try refreshing token on 401
            if status.as_u16() == 401 {
                self.refresh_token().await?;
                return self.list_teams_inner().await;
            }
            anyhow::bail!("Failed to list teams: {}", status);
        }

        let data: GraphTeamsResponse = resp.json().await.context("Failed to parse teams")?;

        Ok(data
            .value
            .into_iter()
            .map(|t| TeamInfo {
                id: t.id,
                name: t.display_name,
            })
            .collect())
    }

    async fn list_teams_inner(&self) -> Result<Vec<TeamInfo>> {
        let token = self.get_token().await?;

        let resp = self
            .http
            .get("https://graph.microsoft.com/v1.0/groups?$filter=resourceProvisioningOptions/Any(x:x eq 'Team')&$select=id,displayName")
            .bearer_auth(&token)
            .send()
            .await
            .context("Failed to list teams")?;

        let data: GraphTeamsResponse = resp.json().await.context("Failed to parse teams")?;

        Ok(data
            .value
            .into_iter()
            .map(|t| TeamInfo {
                id: t.id,
                name: t.display_name,
            })
            .collect())
    }

    pub async fn list_channels(&self, team_id: &str) -> Result<Vec<ChannelInfo>> {
        let token = self.get_token().await?;

        let url = format!(
            "https://graph.microsoft.com/v1.0/teams/{}/channels?$select=id,displayName,membershipType",
            team_id
        );

        let resp = self
            .http
            .get(&url)
            .bearer_auth(&token)
            .send()
            .await
            .context("Failed to list channels")?;

        if !resp.status().is_success() {
            let status = resp.status();
            if status.as_u16() == 401 {
                self.refresh_token().await?;
                return self.list_channels_inner(team_id).await;
            }
            anyhow::bail!("Failed to list channels: {}", status);
        }

        let data: GraphChannelsResponse = resp.json().await.context("Failed to parse channels")?;

        Ok(data
            .value
            .into_iter()
            .map(|ch| ChannelInfo {
                id: ch.id.clone(),
                name: format!(
                    "{}{}",
                    ch.display_name,
                    if ch.membership_type.as_deref() == Some("private") {
                        " (private)"
                    } else {
                        ""
                    }
                ),
                team_id: team_id.to_string(),
            })
            .collect())
    }

    async fn list_channels_inner(&self, team_id: &str) -> Result<Vec<ChannelInfo>> {
        let token = self.get_token().await?;

        let url = format!(
            "https://graph.microsoft.com/v1.0/teams/{}/channels?$select=id,displayName,membershipType",
            team_id
        );

        let resp = self
            .http
            .get(&url)
            .bearer_auth(&token)
            .send()
            .await?;

        let data: GraphChannelsResponse = resp.json().await?;

        Ok(data
            .value
            .into_iter()
            .map(|ch| ChannelInfo {
                id: ch.id.clone(),
                name: ch.display_name,
                team_id: team_id.to_string(),
            })
            .collect())
    }
}

// Credential management via OS keyring
const KEYRING_SERVICE: &str = "com.teamrec.app";
const KEYRING_USER_CLIENT_ID: &str = "teams_client_id";
const KEYRING_USER_TENANT_ID: &str = "teams_tenant_id";
const KEYRING_USER_SECRET: &str = "teams_client_secret";

#[derive(Serialize, Deserialize)]
pub struct TeamsCredentials {
    pub client_id: String,
    pub tenant_id: String,
    pub client_secret: String,
}

pub fn save_credentials(creds: &TeamsCredentials) -> Result<()> {
    let entry_cid =
        keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER_CLIENT_ID).context("Failed to access keyring")?;
    entry_cid
        .set_password(&creds.client_id)
        .context("Failed to save client_id to keyring")?;

    let entry_tid =
        keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER_TENANT_ID).context("Failed to access keyring")?;
    entry_tid
        .set_password(&creds.tenant_id)
        .context("Failed to save tenant_id to keyring")?;

    let entry_sec =
        keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER_SECRET).context("Failed to access keyring")?;
    entry_sec
        .set_password(&creds.client_secret)
        .context("Failed to save client_secret to keyring")?;

    log::info!("Teams credentials saved to OS keyring");
    Ok(())
}

pub fn load_credentials() -> Result<Option<TeamsCredentials>> {
    let entry_cid =
        keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER_CLIENT_ID).context("Failed to access keyring")?;
    let entry_tid =
        keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER_TENANT_ID).context("Failed to access keyring")?;
    let entry_sec =
        keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER_SECRET).context("Failed to access keyring")?;

    let client_id = match entry_cid.get_password() {
        Ok(v) => v,
        Err(keyring::Error::NoEntry) => return Ok(None),
        Err(e) => return Err(anyhow::anyhow!("Failed to load client_id: {}", e)),
    };
    let tenant_id = match entry_tid.get_password() {
        Ok(v) => v,
        Err(keyring::Error::NoEntry) => return Ok(None),
        Err(e) => return Err(anyhow::anyhow!("Failed to load tenant_id: {}", e)),
    };
    let client_secret = match entry_sec.get_password() {
        Ok(v) => v,
        Err(keyring::Error::NoEntry) => return Ok(None),
        Err(e) => return Err(anyhow::anyhow!("Failed to load client_secret: {}", e)),
    };

    Ok(Some(TeamsCredentials {
        client_id,
        tenant_id,
        client_secret,
    }))
}

pub fn delete_credentials() -> Result<()> {
    for user in [KEYRING_USER_CLIENT_ID, KEYRING_USER_TENANT_ID, KEYRING_USER_SECRET] {
        let entry = keyring::Entry::new(KEYRING_SERVICE, user).context("Failed to access keyring")?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(e) => return Err(anyhow::anyhow!("Failed to delete credential: {}", e)),
        }
    }
    Ok(())
}
