# License server

A tiny server that tells each shop's copy of Universal Billing System whether its subscription is active.
You control it from the admin page: add a shop, set "paid until", suspend or re-activate.

**What it stores:** only the license list (shop name, license key, status, paid-until date, how many computers
used it, when it last checked in). It never receives any shop data such as sales, products or customers.

## One-time setup

### 1. MongoDB (free)

1. Create a free account at https://www.mongodb.com/atlas and make a free **M0** cluster.
2. _Database Access_ → add a database user (username + password).
3. _Network Access_ → allow access from anywhere (`0.0.0.0/0`), since the server's address changes.
4. _Connect_ → _Drivers_ → copy the connection string (`mongodb+srv://user:password@cluster.../`).

### 2. The signing key

The server signs every answer with a **private key**; the program only holds the matching **public key**, so
nobody can fake an answer. A key pair was already made for you:

- Private key: `license-keys/private.pem` (next to the project folder). **Keep it secret and back it up.**
  Never put it in git or send it to a client.
- Public key: already inside the program (`src/main/license/config.ts`).

To use the private key on the server, turn it into one line of text:

```bash
base64 -i ../license-keys/private.pem | tr -d '\n'
```

That output is the value for `SIGNING_PRIVATE_KEY_BASE64`. (If you ever lose the private key you must make a
new pair and rebuild the program with the new public key.)

### 3. Deploy the server (for example on Render, free)

1. Put the `license-server` folder in a GitHub repository (it contains no secrets).
2. On https://render.com create a **Web Service** from that repo. Root directory `license-server`,
   build command `npm install`, start command `npm start`.
3. Add these environment variables:

| Name                         | Value                                                                 |
| ---------------------------- | --------------------------------------------------------------------- |
| `MONGODB_URI`                | the connection string from step 1                                     |
| `SIGNING_PRIVATE_KEY_BASE64` | the one-line text from step 2                                         |
| `ADMIN_TOKEN`                | a long random password you choose (this protects the admin page)      |
| `GRACE_DAYS`                 | optional, default `7`: how many days a shop can work without internet |

4. After it starts, open `https://YOUR-SERVICE.onrender.com/health`: it should say `{"ok":true}`.
   (Free Render services sleep when idle, so the first check can take about 30 seconds. That is fine.)

### 4. Tell the program where the server is

Open `src/main/license/config.ts`, set

```ts
export const LICENSE_SERVER_URL = 'https://YOUR-SERVICE.onrender.com'
```

and build the installer again (`npm run build:win`). Until this address is set, the program checks nothing,
so builds made before this step are unaffected.

## Everyday use

Open `https://YOUR-SERVICE.onrender.com/admin`, paste the admin token and click **Load**.

| To do this                  | Do this                                                                                                                            |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Sell to a new shop          | **Add a shop** (name, paid-until date, how many computers). Give the shop the license key shown.                                   |
| Shop paid for another month | **+30 days** (or **Set date**)                                                                                                     |
| Shop did not pay            | **Suspend** (or let the date pass). At its next check the program switches billing off. They can still view and export their data. |
| Shop paid again             | **Activate**                                                                                                                       |
| Shop got a new computer     | **Reset computers**, then they activate again with the same key                                                                    |
| Remove a shop for good      | **Delete**                                                                                                                         |

A shop's program asks the server when it starts and every six hours. Changes reach it at its next check;
a shop without internet keeps working for the grace period, then asks to connect once.

## Run it on your own computer to try it

```bash
cd license-server
npm install
export MONGODB_URI='...' ADMIN_TOKEN='test' SIGNING_PRIVATE_KEY_BASE64="$(base64 -i ../license-keys/private.pem | tr -d '\n')"
npm start
```

## Limits (be honest with yourself and your clients)

- This stops normal shops. A determined technical person can still tamper with a copy of the program.
- The license check is not magic: if a shop never connects to the internet after the grace period, it asks them to.
- Put the terms (what happens when a payment is missed, that data stays exportable) in your agreement.
