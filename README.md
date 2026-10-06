# PALMZ store (dynamic) 

Storefront at `/`, admin panel at `/admin`.

## Run locally
1. `npm install`
2. Copy `.env.example` to `.env` and fill it in (MongoDB, Cloudinary, admin password, WhatsApp number)
3. `npm run seed` (once: loads the 4 starter palms and their photos)
4. `npm run dev` then open http://localhost:3000 and http://localhost:3000/admin

## Deploy on Vercel
- Push to GitHub, import the repo, and add every variable from `.env.example` under Project Settings > Environment Variables
- `MONGODB_URI` must be set there too (a missing or badly-encoded connection string is the usual first-deploy error)
- In MongoDB Atlas > Network Access, allow `0.0.0.0/0` (Vercel's IPs change)
- Run `npm run seed` once from your own computer (with the same `.env`) to load the starter palms

## How stock works
Orders are completed on WhatsApp, so stock is NOT reduced automatically. After you confirm a sale, lower the quantity in `/admin` (the − button, or type the number). The store hides "Choose size" and shows "Sold out" at 0 or when Available is off, and stops customers adding more than the quantity left.
