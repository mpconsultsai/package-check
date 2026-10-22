const { version } = require("./package.json");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_RELEASE: version,
  },
  serverExternalPackages: [
    "@langchain/core",
    "@langchain/groq",
    "@langchain/langgraph",
    "@modelcontextprotocol/sdk",
  ],
};

module.exports = nextConfig;