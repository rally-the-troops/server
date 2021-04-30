#!/bin/bash
#
# Create a simple self-signed SSL certificate.
#

openssl req -nodes -new -x509 -keyout key.pem -out cert.pem
