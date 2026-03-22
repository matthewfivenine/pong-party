const sqlite3 = require("sqlite3").verbose();
const db = new sqlite3.Database("./pong.db");

db.serialize(()=>{
  db.run(`CREATE TABLE IF NOT EXISTS players(
    username TEXT PRIMARY KEY,
    elo INTEGER DEFAULT 1000
  )`);
});

module.exports = db;
