## Setting up the server

All data is stored in an SQLite3 database.

The server and game rules are implemented in Javascript.
The game state is stored in the database as a JSON blob.
The server runs on Node with the Express.js and Socket.io frameworks.

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

HTTP_PORT=8080

HTTPS_PORT=8443
SSL_KEY=/etc/letsencrypt/live/YOUR_DOMAIN/privkey.com
SSL_CERT=/etc/letsencrypt/live/YOUR_DOMAIN/fullchain.pem

MAIL_FROM="Your Site Name <notifications@YOUR_DOMAIN>"
MAIL_HOST=localhost
MAIL_PORT=25
```

If the HTTPS_PORT is missing, the server will only serve HTTP.
If MAIL_HOST/PORT are not present, the server will not send notification emails.

## Resources

Icons are sourced from various places:

* https://game-icons.net/
* https://commons.wikimedia.org/wiki/Main_Page

Fonts:

* https://github.com/adobe-fonts/source-sans
* https://github.com/adobe-fonts/source-serif
* https://www.google.com/get/noto/

Image processing software:

* https://github.com/google/guetzli/
* https://github.com/mozilla/mozjpeg
* https://github.com/svg/svgo
* http://optipng.sourceforge.net/
* http://potrace.sourceforge.net/

