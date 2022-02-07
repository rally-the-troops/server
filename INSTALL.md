## Setting up the server

All data is stored in an SQLite3 database.

The server and game rules are implemented in Javascript.
The game state is stored in the database as a JSON blob.
The server runs on Node with the Express.js framework.

Check out the game submodules:

```
git clone https://github.com/rally-the-troops/julius-caesar.git public/julius-caesar
```

Initialize the database:

```
sqlite3 db < schema.sql
sqlite3 db < public/julius-caesar/title.sql
```

Redirect port 80 and 443 to 8080 and 8443:

```
sudo iptables -A PREROUTING -t nat -p tcp --dport 80 -j REDIRECT --to-ports 8080
sudo iptables -A PREROUTING -t nat -p tcp --dport 443 -j REDIRECT --to-ports 8443
```

Create SSL certificate with Let's Encrypt certbot, or self-signed with OpenSSL:

```
openssl req -nodes -new -x509 -keyout key.pem -out cert.pem
```

Configure the server using the .env file:

```
NODE_ENV=production

SITE_NAME=YOUR_SITE_NAME
SITE_HOST=YOUR_DOMAIN
SITE_URL=https://YOUR_DOMAIN

HTTP_PORT=8080

HTTPS_PORT=8443
SSL_KEY=/etc/letsencrypt/live/YOUR_DOMAIN/privkey.com
SSL_CERT=/etc/letsencrypt/live/YOUR_DOMAIN/fullchain.pem

MAIL_FROM=YOUR_SITE_NAME <notifications@YOUR_DOMAIN>
MAIL_HOST=localhost
MAIL_PORT=25
```

If the HTTPS_PORT is missing, the server will only serve HTTP.

If MAIL_HOST/PORT/FROM are not present, the server will not send notification emails.

Start the server:

```
node server.js
```
