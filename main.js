require('dotenv').config();
const { Octokit } = require("@octokit/rest");
const fs = require("fs");
const GroupManager = require('./group-manager');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const STAR_THRESHOLD = process.env.STAR_THRESHOLD || 300;
const KEYWORDS = ["AI", "chat bot", "web3", "trading", "finance tracking"];
const RESULTS_PER_KEYWORD = process.env.RESULTS_PER_KEYWORD || 5;
const GROUPS_FILE = "groups.json";
const POSTED_REPOS_FILE = "posted-repos.json";
const SELECTED_GROUPS = process.env.SELECTED_GROUPS ? process.env.SELECTED_GROUPS.split(',').map(id => id.trim()) : [];

const octokit = new Octokit({ auth: GITHUB_TOKEN });

// --- Repository tracking functions ---
function getPostedRepos() {
  try {
    if (fs.existsSync(POSTED_REPOS_FILE)) {
      const data = JSON.parse(fs.readFileSync(POSTED_REPOS_FILE, 'utf8'));
      return data.postedRepos || [];
    }
    return [];
  } catch (error) {
    console.error('❌ Error reading posted repos:', error.message);
    return [];
  }
}

function savePostedRepo(repo) {
  try {
    const postedRepos = getPostedRepos();
    const repoData = {
      id: repo.id,
      full_name: repo.full_name,
      html_url: repo.html_url,
      posted_at: new Date().toISOString(),
      stars: repo.stargazers_count
    };
    
    // Avoid duplicates
    if (!postedRepos.find(r => r.id === repo.id)) {
      postedRepos.push(repoData);
      
      // Keep only last 1000 repos to prevent file from growing too large
      if (postedRepos.length > 1000) {
        postedRepos.splice(0, postedRepos.length - 1000);
      }
      
      fs.writeFileSync(POSTED_REPOS_FILE, JSON.stringify({ 
        postedRepos,
        lastUpdated: new Date().toISOString()
      }, null, 2));
    }
  } catch (error) {
    console.error('❌ Error saving posted repo:', error.message);
  }
}

function filterNewRepos(repos) {
  const postedRepos = getPostedRepos();
  const postedIds = new Set(postedRepos.map(r => r.id));
  return repos.filter(repo => !postedIds.has(repo.id));
}

// --- GitHub search ---
async function searchRepos(keyword, searchType = 'popular', customResultsCount = null) {
  try {
    let query, sort, order;
    const resultsCount = customResultsCount || RESULTS_PER_KEYWORD;
    
    if (searchType === 'new') {
      // Search for recently created repositories
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
      const dateFilter = oneWeekAgo.toISOString().split('T')[0];
      
      query = `${keyword} in:name,description created:>${dateFilter} stars:>=${Math.max(10, STAR_THRESHOLD / 10)}`;
      sort = "created";
      order = "desc";
    } else if (searchType === 'trending') {
      // Search for trending repositories (recently gained stars)
      const oneMonthAgo = new Date();
      oneMonthAgo.setDate(oneMonthAgo.getDate() - 30);
      const dateFilter = oneMonthAgo.toISOString().split('T')[0];
      
      query = `${keyword} in:name,description pushed:>${dateFilter} stars:>=${STAR_THRESHOLD}`;
      sort = "updated";
      order = "desc";
    } else {
      // Default: popular repositories
      query = `${keyword} in:name,description stars:>=${STAR_THRESHOLD}`;
      sort = "stars";
      order = "desc";
    }
    
    const results = await octokit.search.repos({
      q: query,
      sort: sort,
      order: order,
      per_page: Math.min(resultsCount, 100), // GitHub API limit is 100
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
          // Search for new repositories first
          const newRepos = await searchRepos(keyword, 'new');
          const filteredNewRepos = filterNewRepos(newRepos);
          
          // If no new repos, search for trending ones
          let reposToPost = filteredNewRepos;
          if (filteredNewRepos.length === 0) {
            const trendingRepos = await searchRepos(keyword, 'trending');
            reposToPost = filterNewRepos(trendingRepos);
          }
          
          // If still no repos, fall back to popular ones
          if (reposToPost.length === 0) {
            const popularRepos = await searchRepos(keyword, 'popular');
            reposToPost = filterNewRepos(popularRepos);
          }
          
          if (reposToPost.length > 0) {
            const msg = formatMessage(reposToPost, keyword);
            
            await client.sendMessage(groupId, { text: msg });
            console.log(`✅ Posted ${reposToPost.length} ${keyword} repos to ${groupId}`);
            
            // Save posted repos to tracking file
            for (const repo of reposToPost) {
              savePostedRepo(repo);
            }
          } else {
            console.log(`ℹ️ No new ${keyword} repos to post to ${groupId}`);
          }
          
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
    
    // Repository search commands
    else if (baseCommand === '!newrepos') {
      if (!isGroup) {
        await client.sendMessage(m.chat, { text: '❌ This command can only be used in groups.' });
        return;
      }
      
      // Check if a keyword was provided
      if (args.length > 0) {
        const customKeyword = args.join(' ');
        console.log(`📱 New repos search for "${customKeyword}" triggered by ${sender} in group ${m.chat}`);
        await client.sendMessage(m.chat, { text: `🔍 Searching for new "${customKeyword}" repositories...` });
        
        try {
          const newRepos = await searchRepos(customKeyword, 'new', 10); // Get top 10
          const filteredRepos = filterNewRepos(newRepos);
          
          if (filteredRepos.length > 0) {
            const msg = formatMessage(filteredRepos, `New ${customKeyword}`);
            await client.sendMessage(m.chat, { text: msg });
            
            // Save posted repos
            for (const repo of filteredRepos) {
              savePostedRepo(repo);
            }
            
            await client.sendMessage(m.chat, { text: `✅ Found ${filteredRepos.length} new repositories for "${customKeyword}"!` });
          } else {
            await client.sendMessage(m.chat, { text: `📭 No new repositories found for "${customKeyword}" that haven't been posted before.` });
          }
        } catch (error) {
          console.error(`Error searching for "${customKeyword}":`, error.message);
          await client.sendMessage(m.chat, { text: `❌ Error searching for "${customKeyword}" repositories.` });
        }
      } else {
        // Original behavior - search all default keywords
        console.log(`📱 New repos search triggered by ${sender} in group ${m.chat}`);
        await client.sendMessage(m.chat, { text: '🔍 Searching for new repositories...' });
        
        let foundRepos = false;
        for (let keyword of KEYWORDS) {
          const newRepos = await searchRepos(keyword, 'new');
          const filteredRepos = filterNewRepos(newRepos);
          
          if (filteredRepos.length > 0) {
            const msg = formatMessage(filteredRepos, `New ${keyword}`);
            await client.sendMessage(m.chat, { text: msg });
            
            // Save posted repos
            for (const repo of filteredRepos) {
              savePostedRepo(repo);
            }
            foundRepos = true;
            
            // Add delay between messages
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }
        
        if (!foundRepos) {
          await client.sendMessage(m.chat, { text: '📭 No new repositories found that haven\'t been posted before.' });
        }
      }
    }
    
    else if (baseCommand === '!trendingrepos') {
      if (!isGroup) {
        await client.sendMessage(m.chat, { text: '❌ This command can only be used in groups.' });
        return;
      }
      
      // Check if a keyword was provided
      if (args.length > 0) {
        const customKeyword = args.join(' ');
        console.log(`📱 Trending repos search for "${customKeyword}" triggered by ${sender} in group ${m.chat}`);
        await client.sendMessage(m.chat, { text: `📈 Searching for trending "${customKeyword}" repositories...` });
        
        try {
          const trendingRepos = await searchRepos(customKeyword, 'trending', 10); // Get top 10
          const filteredRepos = filterNewRepos(trendingRepos);
          
          if (filteredRepos.length > 0) {
            const msg = formatMessage(filteredRepos, `Trending ${customKeyword}`);
            await client.sendMessage(m.chat, { text: msg });
            
            // Save posted repos
            for (const repo of filteredRepos) {
              savePostedRepo(repo);
            }
            
            await client.sendMessage(m.chat, { text: `✅ Found ${filteredRepos.length} trending repositories for "${customKeyword}"!` });
          } else {
            await client.sendMessage(m.chat, { text: `📭 No trending repositories found for "${customKeyword}" that haven't been posted before.` });
          }
        } catch (error) {
          console.error(`Error searching for trending "${customKeyword}":`, error.message);
          await client.sendMessage(m.chat, { text: `❌ Error searching for trending "${customKeyword}" repositories.` });
        }
      } else {
        // Original behavior - search all default keywords
        console.log(`📱 Trending repos search triggered by ${sender} in group ${m.chat}`);
        await client.sendMessage(m.chat, { text: '📈 Searching for trending repositories...' });
        
        let foundRepos = false;
        for (let keyword of KEYWORDS) {
          const trendingRepos = await searchRepos(keyword, 'trending');
          const filteredRepos = filterNewRepos(trendingRepos);
          
          if (filteredRepos.length > 0) {
            const msg = formatMessage(filteredRepos, `Trending ${keyword}`);
            await client.sendMessage(m.chat, { text: msg });
            
            // Save posted repos
            for (const repo of filteredRepos) {
              savePostedRepo(repo);
            }
            foundRepos = true;
            
            // Add delay between messages
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }
        
        if (!foundRepos) {
          await client.sendMessage(m.chat, { text: '📭 No trending repositories found that haven\'t been posted before.' });
        }
      }
    }
    
    else if (command === '!repostats') {
      const postedRepos = getPostedRepos();
      const statsText = `📊 *Repository Statistics*

📈 *Posted Repositories:*
• Total posted: ${postedRepos.length}
• Last updated: ${postedRepos.length > 0 ? new Date(postedRepos[postedRepos.length - 1].posted_at).toLocaleString() : 'Never'}

🔍 *Search Configuration:*
• Keywords: ${KEYWORDS.join(', ')}
• Star threshold: ${STAR_THRESHOLD}+
• Results per keyword: ${RESULTS_PER_KEYWORD}

📝 *Recent Posts (Last 5):*
${postedRepos.slice(-5).reverse().map(repo => 
  `• ${repo.full_name} (${repo.stars}★)`
).join('\n') || 'No repositories posted yet'}`;

      await client.sendMessage(m.chat, { text: statsText });
    }
    
    else if (command === '!clearrepohistory') {
      try {
        if (fs.existsSync(POSTED_REPOS_FILE)) {
          fs.unlinkSync(POSTED_REPOS_FILE);
          await client.sendMessage(m.chat, { text: '🗑️ Repository posting history cleared! All repos will be considered new again.' });
        } else {
          await client.sendMessage(m.chat, { text: '📭 No repository history found to clear.' });
        }
      } catch (error) {
        console.error('Error clearing repo history:', error.message);
        await client.sendMessage(m.chat, { text: '❌ Error clearing repository history.' });
      }
    }
    
    else if (baseCommand === '!searchrepo') {
      if (!isGroup) {
        await client.sendMessage(m.chat, { text: '❌ This command can only be used in groups.' });
        return;
      }
      
      if (args.length === 0) {
        await client.sendMessage(m.chat, { text: '❌ Please provide a keyword to search for.\n\nUsage: `!searchrepo <keyword>`\nExample: `!searchrepo machine learning`' });
        return;
      }
      
      const searchKeyword = args.join(' ');
      console.log(`📱 Search repo for "${searchKeyword}" triggered by ${sender} in group ${m.chat}`);
      await client.sendMessage(m.chat, { text: `🔍 Searching for "${searchKeyword}" repositories with 1000+ stars...` });
      
      try {
        // Search for repositories with 1000+ stars
        const query = `${searchKeyword} in:name,description stars:>=1000`;
        const results = await octokit.search.repos({
          q: query,
          sort: "stars",
          order: "desc",
          per_page: 10, // Top 10 results
        });
        
        const repos = results.data.items || [];
        
        if (repos.length > 0) {
          const msg = formatMessage(repos, `${searchKeyword} (1000+ stars)`);
          await client.sendMessage(m.chat, { text: msg });
          
          // Optionally save to tracking (you can remove this if you don't want to track these searches)
          for (const repo of repos) {
            savePostedRepo(repo);
          }
          
          await client.sendMessage(m.chat, { text: `✅ Found ${repos.length} repositories for "${searchKeyword}" with 1000+ stars!` });
        } else {
          await client.sendMessage(m.chat, { text: `📭 No repositories found for "${searchKeyword}" with 1000+ stars.` });
        }
      } catch (error) {
        console.error(`Error searching for "${searchKeyword}":`, error.message);
        await client.sendMessage(m.chat, { text: `❌ Error searching for "${searchKeyword}" repositories.` });
      }
    }

    // Help command
    else if (command === '!help' || command === '!commands') {
      const helpText = `🤖 *GitHub Repo Bot Commands*

📝 *Posting Commands:*
• \`!postrepos\` or \`!post\` - Post repos to current group
• \`!postall\` - Post repos to all groups
• \`!newrepos [keyword]\` - Search new repositories (top 10 if keyword provided)
• \`!trendingrepos [keyword]\` - Search trending repositories (top 10 if keyword provided)
• \`!searchrepo <keyword>\` - Search any keyword, top 10 repos with 1000+ stars

📋 *Group Management:*
• \`!groups\` - List all available groups
• \`!selectedgroups\` - Show selected groups
• \`!selectgroup <number>\` - Select a group for posting
• \`!unselectgroup <number>\` - Unselect a group
• \`!cleargroups\` - Clear all group selections

📊 *Status & Info:*
• \`!status\` - Show bot and scheduler status
• \`!repostats\` - Show repository posting statistics
• \`!clearrepohistory\` - Clear posted repository history
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
