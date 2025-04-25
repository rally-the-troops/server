# Getting Started

The _Rally the Troops_ software is very simple and has minimal dependencies.
All the data is stored in a single SQLite3 database.
The server runs in a single Node process using the Express.js framework.

To set up an RTT server instance, you will need
the <a href="https://www.sqlite.org/index.html">sqlite3</a> command line tool
and <a href="https://nodejs.org/en">Node</a>.

## Install the server

Check out the server repository.

	git clone https://git.rally-the-troops.com/common/server

In the cloned server directory, install the NPM dependencies:

	npm install

Initialize the database:

	sqlite3 db < schema.sql

## Install the modules

Game modules are found in the "public" directory.
They also need to be registered in the database.

Check out a game module:

	git clone https://git.rally-the-troops.com/modules/field-cloth-gold \
		public/field-cloth-gold

Register it in the database:

	sqlite3 db < public/field-cloth-gold/title.sql

## Start the server

	node server.js

Open the browser to http://localhost:8080/ and create an account.

The first account created will have administrator privileges.
