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
- Push to GitHub, import the repo, and add every variable from `.env` under Project Settings > Environment Variables
- `MONGODB_URI` must be set there too (a missing or badly-encoded connection string is the usual first-deploy error)
- In MongoDB Atlas > Network Access, allow `0.0.0.0/0` (Vercel's IPs change)
- Run `npm run seed` once from your own computer (with the same `.env`) to load the starter palms

## How orders and stock work
Guest and Google-account checkouts can be paid online with Paystack or sent to PALMZ through WhatsApp. Manage requests at `/admin/orders`; statuses are Pending confirmation, Confirmed, Fulfilled, or Cancelled. Updating an order status does not reserve or reduce stock. After you confirm a sale, lower the quantity in `/admin` (the − button, or type the number). The store hides "Choose size" and shows "Sold out" at 0 or when Available is off, and stops customers adding more than the quantity left.

Payment state is stored separately from order status. Set `PAYSTACK_SECRET_KEY` to the Paystack secret key and `APP_URL` to the canonical storefront URL (for example `https://your-domain.example`) to enable online checkout. Use a Paystack **live** secret key (`sk_live_...`) for production; test keys (`sk_test_...`) only work with sandbox transactions and are rejected in production. Configure the Paystack dashboard webhook URL as `https://your-domain.example/api/paystack/webhook`. Online payment is verified server-to-server before an order is marked paid. The verified NGN amount must cover the server-calculated order total; any Paystack fee-inclusive amount is recorded as the actual amount received. Items need prices set in `/admin`; unpriced products remain available through WhatsApp checkout.

Delivery prices and estimated times follow the selected destination state: Kano ₦2,000 (1–2 working days); Jigawa, Katsina, Kaduna, and Bauchi ₦3,500 (2–3 days); FCT (Abuja), Plateau, Gombe, Zamfara, and Yobe ₦5,000 (3–4 days); Nasarawa, Niger, Kebbi, Sokoto, Kogi, Benue, Adamawa, Taraba, and Borno ₦7,000 (4–5 days); Kwara, Enugu, Ebonyi, Anambra, Edo, Ekiti, Osun, Oyo, and Ondo ₦9,000 (5–6 days); Lagos, Ogun, Delta, Imo, Abia, Rivers, Bayelsa, Akwa Ibom, and Cross River ₦11,000 (5–7 days). Pickup has no delivery charge. Delivery prices are maintained in `lib/delivery.js`.

## Product photos
In `/admin`, upload up to 12 JPG, PNG, or WebP photos per product (4 MB total). Photos appear in upload order in the storefront image slider. When editing a product, selecting new photos replaces its current gallery; leaving the photo field empty keeps the existing gallery.

## Customer accounts
Guest checkout remains available. To enable optional Google sign-in, set `GOOGLE_CLIENT_ID` to a Google OAuth 2.0 web client ID and configure its authorized JavaScript origins for the local site and deployed domain. Keep `JWT_SECRET` set for signed customer sessions. Signed-in customers can see checkout requests in their account; requests are saved as pending confirmation when sent to WhatsApp, and are not confirmed sales or stock reservations.

Set the customer-facing application name and logo in Google Cloud Console under Google Auth Platform > Branding. Google displays that OAuth branding (currently reported as “Kano Wholesale”) during sign-in; it is controlled by the Google Cloud project, not by the storefront page. Set the app name to PALMZ and configure the support email and authorized domains there.
