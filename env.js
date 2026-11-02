// env.js – måste vara första importen i server.js. ES-importer körs i ordning,
// så .env är inläst innan db.js och agent.js läser process.env.
import dotenv from 'dotenv';
dotenv.config({ quiet: true });
