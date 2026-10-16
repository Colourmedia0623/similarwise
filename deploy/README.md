# Running the app on EC2

Every push to `main` that passes CI is built into a Docker image on GitHub's
runners (sharing CI's layer cache), loaded onto the EC2 instance and restarted
with Docker Compose. Only the `deploy/` folder is copied to the server. Caddy
serves it over HTTPS with a certificate it fetches and renews itself.

Similarwise has its own instance, separate from the other apps, so no app's
deploys or load can affect another.

## One-time setup

### 1. Launch the instance

In the EC2 console (London, eu-west-2):

- **Name:** `similarwise`
- **AMI:** Ubuntu Server 24.04 LTS
- **Instance type:** t3.small
- **Key pair:** create a new one called `similarwise` and download the `.pem` file
- **Security group:** allow SSH (22), HTTP (80) and HTTPS (443) from anywhere
- **Storage:** 20 GB
- **Advanced details → User data:** paste the contents of `deploy/ec2-user-data.sh`

Then allocate an **Elastic IP** and associate it with the instance, so the
address survives restarts.

### 2. Point the app's address at it

Add an A record for `similarwise.colourmedia.net` pointing at the Elastic IP.

### 3. Create the app in Shopify

In the Shopify Dev Dashboard, create an app called **Similarwise**. Copy its
**Client ID** into `client_id` in `shopify.app.toml`, and keep its **Client
secret** for the next step. Under Settings, generate an **App Automation
Token**.

### 4. Add GitHub secrets

In the GitHub repo, **Settings → Secrets and variables → Actions**:

| Kind | Name | Value |
| --- | --- | --- |
| Secret | `EC2_HOST` | The Elastic IP |
| Secret | `EC2_SSH_KEY` | The whole contents of `similarwise.pem` |
| Secret | `SHOPIFY_API_KEY` | The Client ID |
| Secret | `SHOPIFY_API_SECRET` | The Client secret |
| Secret | `SHOPIFY_APP_AUTOMATION_TOKEN` | The App Automation Token |
| Variable | `APP_HOST` | `similarwise.colourmedia.net` |

### 5. Deploy

Run the **Deploy to EC2** workflow from the Actions tab (or push to `main`),
then the **Push Shopify app config** workflow so Shopify has the app's URLs,
scopes and webhooks. Open `https://similarwise.colourmedia.net`; you should
see the app's landing page. Then install it on a development store from the
Dev Dashboard.

## Day to day

- Logs: `ssh -i similarwise.pem ubuntu@<EC2_HOST>` then
  `cd /opt/similarwise/src/deploy && docker compose logs -f app`
- The SQLite database lives in the `app-data` Docker volume and survives deploys.
