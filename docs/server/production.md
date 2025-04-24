# Running a public server

To let other people connect to your server and play games, there are a few other things you will need to set up.

## Recovering from a crash

Use <tt>nodemon</tt> to restart the server if it crashes.
This also restarts the server if the software is updated.

	nodemon server.js

## Database &amp; Backups

For best performance, you should turn on WAL mode on the database.

	sqlite3 db "pragma journal_mode = wal"

You will want to backup your database periodically. This is easy to do with a single sqlite command.
Schedule the following command using cron or something similar, and make sure to copy the resulting
backup database to another machine!

	sqlite3 db "vacuum into strftime('backup-%Y%m%d-%H%M.db')"

## Customize settings

The server reads its settings from the .env file.

	NODE_ENV=production

	SITE_NAME=Example
	SITE_URL=https://example.com
	SITE_IMPRINT="This website is operated by ..."

	HTTP_HOST=localhost
	HTTP_PORT=8080

	# Enable mail notifications
	MAIL_FROM=Example Notifications <notifications@example.com>
	MAIL_HOST=localhost
	MAIL_PORT=25

	# Enable webhooks
	WEBHOOKS=1

	# Enable forum
	FORUM=1

## Expose the server to the internet

For simplicity, the server only talks plain HTTP on localhost.
To expose the server to your LAN and/or WAN, either listen to 0.0.0.0 or use a reverse proxy server such as Nginx.
To use SSL (HTTPS) you need a reverse proxy server.

Here is an example Nginx configuration:

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
			proxy_read_timeout 86400s;
			proxy_send_timeout 86400s;
		}
	}

## Archive

Storing all the games ever played requires a lot of space. To keep the size of
the main database down, you can delete and/or archive finished games periodically.

You can copy the game state and replay data for finished games to a separate archive database.
Below are the tools to archive (and restore) the game state data.
Run the archive and purge scripts as part of the backup cron job.

Copy game state data of finished games into archive database.

	sqlite3 tools/archive.sql

Delete game state data of finished games over a certain age.

	sqlite3 tools/purge.sql

Restore archived game state.

	bash tools/unarchive.sh game_id

