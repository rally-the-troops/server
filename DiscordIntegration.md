# upgrade existing data

```
echo "ALTER TABLE users ADD COLUMN webhook_id text;" | sqlite3 db
echo "ALTER TABLE users ADD COLUMN webhook_url text;" | sqlite3 db
```

# install superagent
npm install superagent

# testing
Add early return false to is_online

