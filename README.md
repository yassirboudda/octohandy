# Stockflow (hackathon POV)

Front Next.js pour un nouveau hackathon, inspiré de [Comie](https://comie.amirelay.com):

- **Clerk** (même instance / mêmes clés que Comie)
- **Chat** avec upload d’images (réponses mock locales)
- **Boutique** (comptes marketplace mock)
- **Stock** + création d’équipe / code d’invitation / merge de stock
- **Workflows** templates par marketplace (ex. Vinted favoris → offre discount)

Pas de backend dans ce repo. Les données POV sont en `localStorage`. Le vrai API ira sur un autre VPS plus tard.

## Dev

```bash
cp .env.example .env.local
# renseigner NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY + CLERK_SECRET_KEY (mêmes que Comie)
npm install
npm run dev
```

Ouvre http://localhost:3000

## Deploy

Repo: https://github.com/yassirboudda/hackathon  
POV: https://stockflow-nine-ashy.vercel.app

```bash
git push origin main
# Vercel redeploy auto via GitHub, ou:
vercel --prod
```

Dans Clerk (même instance que Comie), ajoute `https://stockflow-nine-ashy.vercel.app` aux allowed origins / redirect URLs (`/sign-in`, `/sign-up`, `/dashboard`).
