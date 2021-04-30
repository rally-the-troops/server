## Setting up the server

All data is stored in an SQLite3 database.

The server and game rules are implemented in Javascript.
The game state is stored in the database as a JSON blob.
The server runs on Node with the Express.js and Socket.io frameworks.

Redirect port 80 and 443 to 8080 and 80443:

```
sudo iptables -A PREROUTING -t nat -p tcp --dport 80 -j REDIRECT --to-ports 8080
sudo iptables -A PREROUTING -t nat -p tcp --dport 443 -j REDIRECT --to-ports 8443
```

Create SSL certificate with Let's Encrypt certbot, or self-signed with OpenSSL:

```
openssl req -nodes -new -x509 -keyout key.pem -out cert.pem
```

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
* https://github.com/svg/svgo
* http://optipng.sourceforge.net/
* http://potrace.sourceforge.net/

