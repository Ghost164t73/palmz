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
- In production, use an `ADMIN_PASSWORD` of at least 16 characters and a randomly generated `JWT_SECRET` of at least 32 bytes; authentication fails closed if either is weaker. Keep `.env` out of Git.
- In MongoDB Atlas > Network Access, allow `0.0.0.0/0` (Vercel's IPs change)
- Run `npm run seed` once from your own computer (with the same `.env`) to load the starter palms

## How orders and stock work
Guest and Google-account checkouts can be paid online with Paystack or sent to PALMZ through WhatsApp. Inventory is reserved atomically when an order is submitted, so the shop immediately reduces availability for its color/size. In `/admin/orders`, confirming an order commits that reservation without deducting stock a second time; cancelling an order returns the reserved units. Legacy orders without a reservation still deduct stock on confirmation. Before deploying this change, confirm or cancel every existing pending order; checkout pauses while unresolved pre-reservation orders remain. MongoDB transactions are required (MongoDB Atlas supports them). Paystack orders must be paid before they can be confirmed. Pending WhatsApp orders and unpaid Paystack orders hold stock until cancelled or, for Paystack, a failed/abandoned payment is verified. There is no automatic expiry for a pending hold; review and cancel abandoned orders in `/admin/orders`. The store hides "Choose size" and shows "Sold out" at 0 or when Available is off.

Payment state is stored separately from order status. Set `PAYSTACK_SECRET_KEY` to the Paystack secret key and `APP_URL` to the canonical storefront URL (for example `https://your-domain.example`) to enable online checkout. Use a Paystack **live** secret key (`sk_live_...`) for production; test keys (`sk_test_...`) only work with sandbox transactions and are rejected in production. Configure the Paystack dashboard webhook URL as `https://your-domain.example/api/paystack/webhook`. Online payment is verified server-to-server before an order is marked paid. If Paystack charges the customer more than the order total, verification accepts the difference only when Paystack's `requested_amount` exactly matches PALMZ's server-calculated order total; the extra is separately recorded as a Paystack checkout charge. For WhatsApp orders, open the order in `/admin/orders` and record the amount received and optional payment reference after verifying the payment manually. Items need prices set in `/admin`; unpriced products remain available through WhatsApp checkout.

## Order emails
Transactional emails are sent through Resend. Verify your sending domain with Resend and publish the SPF/DKIM DNS records it provides before sending live mail. In Vercel Project Settings > Environment Variables, add these for Production:

- `RESEND_API_KEY`: a Resend API key; keep it server-side and never add it to frontend code.
- `EMAIL_FROM`: a sender on the verified domain, for example `PALMZ <orders@yourdomain.com>`.
- `ADMIN_EMAIL`: the address that receives new-order alerts.
- `SUPPORT_EMAIL` (optional): the customer-support address shown in customer emails.

Redeploy after adding or changing variables. Submitted WhatsApp orders alert the admin address; Paystack orders alert the admin after payment is verified, so abandoned checkouts do not generate paid-order alerts. A verified successful Paystack payment emails the customer, and changing an order to Confirmed or Fulfilled emails the address saved on that order. Email delivery failures do not roll back orders or payments; they are recorded on the order and logged. There is no background retry queue, so monitor Resend delivery and Vercel function logs. The sender is `EMAIL_FROM`; customer-provided values are escaped in the HTML templates.

Delivery is ₦5,000 across zones, with ₦2,000 rates for Kano, FCT (Abuja), and Lokoja, Kogi. Delivery estimates continue to vary by zone. The state dropdown shows state names only. Pickup at the Lokoja and Abuja branches has no delivery charge. Delivery prices are maintained in `lib/delivery.js`.

## Product photos
In `/admin`, upload up to 12 JPG, PNG, or WebP photos per product (4 MB total). Photos appear in upload order in the storefront image slider. When editing a product, selecting new photos replaces its current gallery; leaving the photo field empty keeps the existing gallery.

## Customer accounts
Guest checkout remains available. To enable optional Google sign-in, set `GOOGLE_CLIENT_ID` to a Google OAuth 2.0 web client ID and configure its authorized JavaScript origins for the local site and deployed domain. Keep `JWT_SECRET` set for signed customer sessions. Signed-in customers can see checkout requests in their account; requests are saved as pending confirmation when sent to WhatsApp, and are not confirmed sales or stock reservations.

Set the customer-facing application name and logo in Google Cloud Console under Google Auth Platform > Branding. Google displays that OAuth branding (currently reported as “Kano Wholesale”) during sign-in; it is controlled by the Google Cloud project, not by the storefront page. Set the app name to PALMZ and configure the support email and authorized domains there.
