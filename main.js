require('dotenv').config();
const { Octokit } = require("@octokit/rest");
const fs = require("fs");
const GroupManager = require('./group-manager');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const STAR_THRESHOLD = process.env.STAR_THRESHOLD || 300;
const KEYWORDS = ["AI", "chat bot", "web3", "trading", "finance tracking"];
const RESULTS_PER_KEYWORD = process.env.RESULTS_PER_KEYWORD || 5;
const GROUPS_FILE = "groups.json";
const SELECTED_GROUPS = process.env.SELECTED_GROUPS ? process.env.SELECTED_GROUPS.split(',').map(id => id.trim()) : [];

const octokit = new Octokit({ auth: GITHUB_TOKEN });

// --- GitHub search ---
async function searchRepos(keyword) {
  try {
    const query = `${keyword} in:name,description stars:>=${STAR_THRESHOLD}`;
    const results = await octokit.search.repos({
      q: query,
      sort: "stars",
      order: "desc",
      per_page: RESULTS_PER_KEYWORD,
    });
    return results.data.items || [];
  } catch (error) {
    console.error(`❌ Error searching repos for keyword "${keyword}":`, error.message);
    return [];
  }
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
  try {
    const groups = await client.groupFetchAllParticipating();
    const groupIds = Object.keys(groups);

    fs.writeFileSync(GROUPS_FILE, JSON.stringify({ groups: groupIds }, null, 2));
    console.log("📝 Saved groups.json:", groupIds);
    return groupIds;
  } catch (error) {
    console.error("❌ Error saving groups:", error.message);
    return [];
  }
}

// --- Post repos to selected or all groups ---
async function postToAllGroups(client, selectedGroupIds = null) {
  try {
    let groupIds = [];
    const groupManager = new GroupManager();

    // Use provided group IDs, or get from group manager, or get from environment, or get all groups
    if (selectedGroupIds && selectedGroupIds.length > 0) {
      groupIds = selectedGroupIds;
      console.log("📤 Posting to provided groups:", groupIds);
    } else {
      // Check group manager for selected groups
      const managerSelectedGroups = groupManager.getSelectedGroups();
      if (managerSelectedGroups.length > 0) {
        groupIds = managerSelectedGroups;
        console.log("📤 Posting to manager-selected groups:", groupIds);
      } else if (SELECTED_GROUPS.length > 0) {
        groupIds = SELECTED_GROUPS;
        console.log("📤 Posting to env-configured groups:", groupIds);
      } else {
        // Get all groups
        if (fs.existsSync(GROUPS_FILE)) {
          groupIds = JSON.parse(fs.readFileSync(GROUPS_FILE)).groups;
        } else {
          groupIds = await saveGroups(client);
        }
        console.log("📤 Posting to all groups:", groupIds.length, "groups");
      }
    }

    if (groupIds.length === 0) {
      console.log("⚠️ No groups found to post to");
      return;
    }

    let successCount = 0;
    let errorCount = 0;

    for (let groupId of groupIds) {
      try {
        console.log(`📨 Posting to group: ${groupId}`);
        
        for (let keyword of KEYWORDS) {
          const repos = await searchRepos(keyword);
          const msg = formatMessage(repos, keyword);
          
          await client.sendMessage(groupId, { text: msg });
          console.log(`✅ Posted ${keyword} repos to ${groupId}`);
          
          // Add delay between messages to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
        successCount++;
      } catch (error) {
        console.error(`❌ Error posting to group ${groupId}:`, error.message);
        errorCount++;
      }
    }

    console.log(`🎉 Posting completed! Success: ${successCount}, Errors: ${errorCount}`);
  } catch (error) {
    console.error("❌ Error in postToAllGroups:", error.message);
  }
}

// --- Message handler for manual commands ---
async function handleMessage(client, m, chatUpdate) {
  try {
    if (!m.body) return;
    
    const command = m.body.toLowerCase().trim();
    const args = command.split(' ').slice(1);
    const baseCommand = command.split(' ')[0];
    const isGroup = m.isGroup;
    const sender = m.sender;
    
    // Initialize group manager
    const groupManager = new GroupManager();
    
    // Manual trigger commands
    if (command === '!postrepos' || command === '!post') {
      if (!isGroup) {
        await client.sendMessage(m.chat, { text: '❌ This command can only be used in groups.' });
        return;
      }
      
      console.log(`📱 Manual post triggered by ${sender} in group ${m.chat}`);
      await client.sendMessage(m.chat, { text: '🚀 Starting manual GitHub repo posting...' });
      
      // Post to current group only
      await postToAllGroups(client, [m.chat]);
      
      await client.sendMessage(m.chat, { text: '✅ Manual posting completed!' });
    }
    
    // Post to all groups command (admin only - you can add admin check here)
    else if (command === '!postall') {
      console.log(`📱 Post to all groups triggered by ${sender}`);
      await client.sendMessage(m.chat, { text: '🚀 Starting GitHub repo posting to all groups...' });
      
      await postToAllGroups(client);
      
      await client.sendMessage(m.chat, { text: '✅ Posting to all groups completed!' });
    }
    
    // Group management commands
    else if (['!groups', '!listgroups', '!selectedgroups', '!selectgroup', '!unselectgroup', '!cleargroups'].includes(baseCommand)) {
      await groupManager.handleGroupCommand(client, m, baseCommand, args);
    }
    
    // Scheduler status command
    else if (command === '!status' || command === '!schedulerstatus') {
      if (global.botScheduler) {
        const status = global.botScheduler.getStatus();
        const statusText = `🤖 *Bot Status*

⚙️ *Scheduler:*
• Running: ${status.isRunning ? '✅ Yes' : '❌ No'}
• Auto-posting: ${status.autoPostEnabled ? '✅ Enabled' : '❌ Disabled'}
• Interval: Every ${status.postIntervalHours} hours
• Post time: ${status.postTime}
• Next post: ${status.nextPost || 'Not scheduled'}

📊 *Configuration:*
• Selected groups: ${groupManager.getSelectedGroups().length} groups
• Keywords: ${KEYWORDS.length} keywords
• Star threshold: ${STAR_THRESHOLD}+
• Results per keyword: ${RESULTS_PER_KEYWORD}`;

        await client.sendMessage(m.chat, { text: statusText });
      } else {
        await client.sendMessage(m.chat, { text: '❌ Scheduler not initialized.' });
      }
    }
    
    // Help command
    else if (command === '!help' || command === '!commands') {
      const helpText = `🤖 *GitHub Repo Bot Commands*

📝 *Posting Commands:*
• \`!postrepos\` or \`!post\` - Post repos to current group
• \`!postall\` - Post repos to all groups

📋 *Group Management:*
• \`!groups\` - List all available groups
• \`!selectedgroups\` - Show selected groups
• \`!selectgroup <number>\` - Select a group for posting
• \`!unselectgroup <number>\` - Unselect a group
• \`!cleargroups\` - Clear all group selections

📊 *Status & Info:*
• \`!status\` - Show bot and scheduler status
• \`!help\` - Show this help message

🔧 *Features:*
• Automatic daily posting (configurable)
• Manual triggers for immediate posting
• Group selection support
• Error handling and logging

⚙️ *Configuration:*
Edit your \`.env\` file to customize:
• \`AUTO_POST_ENABLED\` - Enable/disable auto posting
• \`POST_TIME_HOUR\` - Hour for daily posting (0-23)
• \`SELECTED_GROUPS\` - Specific groups to post to`;

      await client.sendMessage(m.chat, { text: helpText });
    }
  } catch (error) {
    console.error('❌ Error in message handler:', error.message);
  }
}

module.exports = {
  handleMessage,
  postToAllGroups,
  saveGroups
};
