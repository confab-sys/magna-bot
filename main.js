const { Octokit } = require("@octokit/rest");
const fs = require("fs");

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "<your-github-token>";
const STAR_THRESHOLD = 300;
const KEYWORDS = ["AI", "chat bot", "web3", "trading", "finance tracking"];
const RESULTS_PER_KEYWORD = 5;
const GROUPS_FILE = "groups.json";

const octokit = new Octokit({ auth: GITHUB_TOKEN });

// --- GitHub search ---
async function searchRepos(keyword) {
  const query = `${keyword} in:name,description stars:>=${STAR_THRESHOLD}`;
  const results = await octokit.search.repos({
    q: query,
    sort: "stars",
    order: "desc",
    per_page: RESULTS_PER_KEYWORD,
  });
  return results.data.items || [];
}

// --- Format GitHub repos for WhatsApp ---
function formatMessage(repos, keyword) {
  if (!repos.length) return ` No active repos found for *${keyword}*`;

  let msg = ` *Top GitHub Repos for ${keyword}* \n\n`;
  for (let repo of repos) {
    msg += ` *${repo.full_name}* (${repo.stargazers_count}★)\n`;
    msg += `${repo.description || "No description"}\n`;
    msg += `🔗 ${repo.html_url}\n\n`;
  }
  return msg;
}

// --- Save all group IDs dynamically ---
async function saveGroups(client) {
  const groups = await client.groupFetchAllParticipating();
  const groupIds = Object.keys(groups);

  fs.writeFileSync(GROUPS_FILE, JSON.stringify({ groups: groupIds }, null, 2));
  console.log(" Saved groups.json:", groupIds);
  return groupIds;
}

// --- Post repos to all groups ---
async function postToAllGroups(client) {
  let groupIds = [];

  if (fs.existsSync(GROUPS_FILE)) {
    groupIds = JSON.parse(fs.readFileSync(GROUPS_FILE)).groups;
  } else {
    groupIds = await saveGroups(client);
  }

  for (let groupId of groupIds) {
    for (let keyword of KEYWORDS) {
      const repos = await searchRepos(keyword);
      const msg = formatMessage(repos, keyword);
      await client.sendMessage(groupId, { text: msg });
    }
  }
}

module.exports = { postToAllGroups, saveGroups };
