# Render deployment — no Cloudflare installation

[Deploy the prepared service](https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2Ftufeeq%2Fai%2Ftree%2Ftagit-next-independent-20260914)

The root `render.yaml` describes only the TAGit NEXT price observer, using this
branch and `tagit-next/quote-service`. No upload or local package installation is
required. Render prompts for `ALPACA_API_KEY_ID` and `ALPACA_API_SECRET_KEY` during
initial setup; enter them only in Render's protected environment fields.

The template explicitly uses the free compute plan for connection testing and
disables automatic redeployment. It does not initiate a paid subscription. Free
services sleep after 15 minutes without inbound traffic and are not suitable for
continuous production collection. Select an always-on paid compute plan in Render
before relying on uninterrupted service. The frontend still polls only while open;
this is not the independent background recorder or a validated trading strategy.

The server binds to `0.0.0.0` and Render's assigned `PORT`. `/api/health` proves
process configuration only. After deployment, verify the service's real URL:

```
node scripts/verify-connection.mjs https://YOUR-SERVICE.onrender.com SENS,NUAI,BTCT --write-config
```

Publish the updated frontend config only after successful verification. The default
feed is IEX, which covers one exchange. SIP requires an entitled subscription;
changing hosting does not change data entitlements. The template contains no keys.

Official references:
- https://render.com/docs/deploy-to-render
- https://render.com/docs/blueprint-spec
- https://render.com/docs/free
