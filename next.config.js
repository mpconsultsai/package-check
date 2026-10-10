/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: [
    "@langchain/core",
    "@langchain/groq",
    "@langchain/langgraph",
    "@modelcontextprotocol/sdk",
  ],
};

module.exports = nextConfig;