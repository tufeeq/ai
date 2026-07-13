# MyAI — free local AI website

This is a static AI chat website. The language model runs in the visitor's browser using WebLLM and WebGPU, so there is no backend and no paid API key.

## Run locally

Because browser modules require HTTP, do not open `index.html` directly from the file system.

Option 1 — VS Code:
1. Install the Live Server extension.
2. Open this folder.
3. Right-click `index.html` and choose **Open with Live Server**.

Option 2 — Python:
```bash
python -m http.server 8000
```
Then visit `http://localhost:8000`.

## Publish free with GitHub Pages

1. Create a free GitHub account and a new **public** repository.
2. Upload all files in this folder to the repository root.
3. Open **Settings → Pages**.
4. Under **Build and deployment**, select **Deploy from a branch**.
5. Select `main` and `/root`, then save.
6. GitHub will display your public website address.

## Important limitations

- The first visit downloads a model that may be hundreds of MB or more.
- A recent Chrome or Edge browser with WebGPU support is recommended.
- Speed depends on the visitor's device.
- Hosting can be free, but a custom domain name usually costs money.
- The webpage imports WebLLM from a public CDN and downloads open model files from their hosting source.
