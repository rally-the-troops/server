## Setting up the server

All data is stored in an SQLite3 database.

The server and game rules are implemented in Javascript.
The game state is stored in the database as a JSON blob.
The server runs on Node with the Express.js framework.

Check out the game submodules:

```
git clone https://git.rally-the-troops.com/modules/julius-caesar public/julius-caesar
```

Initialize the database:

```
sqlite3 db < schema.sql
sqlite3 db < public/julius-caesar/title.sql
```

Configure the server using the .env file:

```
NODE_ENV=production

SITE_NAME=Example
SITE_URL=https://example.com

HTTP_HOST=localhost
HTTP_PORT=8080

MAIL_FROM=Example <notifications@example.com>
MAIL_HOST=localhost
MAIL_PORT=25
```

If MAIL_HOST/PORT/FROM are not present, the server will not send notification emails.

Start the server:

```
node server.js
```

To use SSL you should run the site behind a reverse proxy server, such as Nginx.
Here is an example Nginx configuration:

```
server {
	listen 80;
	server_name example.com www.example.com;
	return 301 https://$host$request_uri;
}

server {
	listen 443 ssl;
	server_name example.com www.example.com;
	ssl_certificate /path/to/ssl/certificate/fullchain.cer;
	ssl_certificate_key /path/to/ssl/certificate/example.com.key;
	root /path/to/server/public;
	location / {
		try_files $uri @rally;
	}
	location @rally {
                proxy_pass http://127.0.0.1:8080;
                proxy_http_version 1.1;
                proxy_set_header Host $host;
                proxy_set_header X-Real-IP $remote_addr;
                proxy_set_header Upgrade $http_upgrade;
                proxy_set_header Connection "upgrade";
                proxy_read_timeout 3600s;
                proxy_send_timeout 3600s;
        }
}
```
