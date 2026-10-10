# PALMZ store (dynamic) 

Storefront at `/`, products-only shop at `/shop`, product details at
`/product/:id`, cart at `/cart`, checkout at `/checkout`, and the PALMZ about
page at `/about`. Admin panel at `/admin`.

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

## How orders and stock work
Guest and Google-account checkouts are saved as order requests and then opened in WhatsApp. Manage requests at `/admin/orders`; statuses are Pending confirmation, Confirmed, Fulfilled, or Cancelled. Updating an order status does not reserve or reduce stock. After you confirm a sale, lower the quantity in `/admin` (the − button, or type the number). The store hides "Choose size" and shows "Sold out" at 0 or when Available is off, and stops customers adding more than the quantity left.

Payment state is stored separately from order status. WhatsApp requests start with payment not started; this does not mark an order as paid. A future Paystack integration can update payment state independently.

## Product photos
In `/admin`, upload up to 12 JPG, PNG, or WebP photos per product (4 MB total). Photos appear in upload order in the storefront image slider. When editing a product, selecting new photos replaces its current gallery; leaving the photo field empty keeps the existing gallery.

## Customer accounts
Guest checkout remains available. To enable optional Google sign-in, set `GOOGLE_CLIENT_ID` to a Google OAuth 2.0 web client ID and configure its authorized JavaScript origins for the local site and deployed domain. Keep `JWT_SECRET` set for signed customer sessions. Signed-in customers can see checkout requests in their account; requests are saved as pending confirmation when sent to WhatsApp, and are not confirmed sales or stock reservations.

Set the customer-facing application name and logo in Google Cloud Console under Google Auth Platform > Branding. Google displays that OAuth branding (currently reported as “Kano Wholesale”) during sign-in; it is controlled by the Google Cloud project, not by the storefront page. Set the app name to PALMZ and configure the support email and authorized domains there.
