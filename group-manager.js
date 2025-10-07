require('dotenv').config();
const fs = require('fs');
const path = require('path');

class GroupManager {
  constructor() {
    this.groupsFile = 'groups.json';
    this.selectedGroupsFile = 'selected-groups.json';
  }

  // Get all available groups
  async getAllGroups(client) {
    try {
      const groups = await client.groupFetchAllParticipating();
      const groupList = [];
      
      for (const [id, group] of Object.entries(groups)) {
        groupList.push({
          id: id,
          name: group.subject || 'Unknown Group',
          participants: group.participants ? group.participants.length : 0,
          description: group.desc || ''
        });
      }
      
      // Save to file for reference
      fs.writeFileSync(this.groupsFile, JSON.stringify({ 
        groups: Object.keys(groups),
        groupDetails: groupList,
        lastUpdated: new Date().toISOString()
      }, null, 2));
      
      return groupList;
    } catch (error) {
      console.error('❌ Error fetching groups:', error.message);
      return [];
    }
  }

  // Get currently selected groups
  getSelectedGroups() {
    try {
      if (fs.existsSync(this.selectedGroupsFile)) {
        const data = JSON.parse(fs.readFileSync(this.selectedGroupsFile, 'utf8'));
        return data.selectedGroups || [];
      }
      return [];
    } catch (error) {
      console.error('❌ Error reading selected groups:', error.message);
      return [];
    }
  }

  // Set selected groups
  setSelectedGroups(groupIds) {
    try {
      const data = {
        selectedGroups: groupIds,
        lastUpdated: new Date().toISOString()
      };
      
      fs.writeFileSync(this.selectedGroupsFile, JSON.stringify(data, null, 2));
      console.log('✅ Selected groups updated:', groupIds);
      return true;
    } catch (error) {
      console.error('❌ Error saving selected groups:', error.message);
      return false;
    }
  }

  // Add a group to selection
  addGroupToSelection(groupId) {
    const currentSelection = this.getSelectedGroups();
    if (!currentSelection.includes(groupId)) {
      currentSelection.push(groupId);
      return this.setSelectedGroups(currentSelection);
    }
    return true;
  }

  // Remove a group from selection
  removeGroupFromSelection(groupId) {
    const currentSelection = this.getSelectedGroups();
    const newSelection = currentSelection.filter(id => id !== groupId);
    return this.setSelectedGroups(newSelection);
  }

  // Clear all selected groups
  clearSelection() {
    return this.setSelectedGroups([]);
  }

  // Get group details by ID
  getGroupDetails(groupId) {
    try {
      if (fs.existsSync(this.groupsFile)) {
        const data = JSON.parse(fs.readFileSync(this.groupsFile, 'utf8'));
        return data.groupDetails?.find(group => group.id === groupId) || null;
      }
      return null;
    } catch (error) {
      console.error('❌ Error getting group details:', error.message);
      return null;
    }
  }

  // Format groups list for display
  formatGroupsList(groups, selectedGroups = []) {
    if (!groups || groups.length === 0) {
      return '❌ No groups found.';
    }

    let message = '📋 *Available WhatsApp Groups:*\n\n';
    
    groups.forEach((group, index) => {
      const isSelected = selectedGroups.includes(group.id);
      const status = isSelected ? '✅' : '⭕';
      const participants = group.participants > 0 ? ` (${group.participants} members)` : '';
      
      message += `${status} ${index + 1}. *${group.name}*${participants}\n`;
      message += `   ID: \`${group.id}\`\n\n`;
    });

    message += '\n💡 *Legend:*\n';
    message += '✅ = Selected for posting\n';
    message += '⭕ = Not selected\n\n';
    message += '*Commands:*\n';
    message += '• `!selectgroup <number>` - Select a group\n';
    message += '• `!unselectgroup <number>` - Unselect a group\n';
    message += '• `!cleargroups` - Clear all selections\n';
    message += '• `!selectedgroups` - Show selected groups';

    return message;
  }

  // Handle group selection commands
  async handleGroupCommand(client, m, command, args) {
    try {
      const isGroup = m.isGroup;
      
      switch (command) {
        case '!groups':
        case '!listgroups':
          const allGroups = await this.getAllGroups(client);
          const selectedGroups = this.getSelectedGroups();
          const groupsList = this.formatGroupsList(allGroups, selectedGroups);
          await client.sendMessage(m.chat, { text: groupsList });
          break;

        case '!selectedgroups':
          const selected = this.getSelectedGroups();
          if (selected.length === 0) {
            await client.sendMessage(m.chat, { text: '📝 No groups currently selected. Use `!groups` to see available groups.' });
          } else {
            let message = '✅ *Selected Groups for Posting:*\n\n';
            selected.forEach((groupId, index) => {
              const details = this.getGroupDetails(groupId);
              const name = details ? details.name : 'Unknown Group';
              message += `${index + 1}. *${name}*\n   ID: \`${groupId}\`\n\n`;
            });
            await client.sendMessage(m.chat, { text: message });
          }
          break;

        case '!selectgroup':
          if (!args[0]) {
            await client.sendMessage(m.chat, { text: '❌ Please specify a group number. Use `!groups` to see available groups.' });
            return;
          }
          
          const groupIndex = parseInt(args[0]) - 1;
          const groups = await this.getAllGroups(client);
          
          if (!groups || groups.length === 0) {
            await client.sendMessage(m.chat, { text: '❌ No groups available. Please try again later or check bot permissions.' });
            return;
          }
          
          if (groupIndex < 0 || groupIndex >= groups.length) {
            await client.sendMessage(m.chat, { text: '❌ Invalid group number. Use `!groups` to see available groups.' });
            return;
          }
          
          const groupToSelect = groups[groupIndex];
          if (!groupToSelect || !groupToSelect.id) {
            await client.sendMessage(m.chat, { text: '❌ Invalid group data. Please try refreshing the groups list with `!groups`.' });
            return;
          }
          
          if (this.addGroupToSelection(groupToSelect.id)) {
            await client.sendMessage(m.chat, { text: `✅ Added *${groupToSelect.name}* to selected groups.` });
          } else {
            await client.sendMessage(m.chat, { text: '❌ Failed to select group.' });
          }
          break;

        case '!unselectgroup':
          if (!args[0]) {
            await client.sendMessage(m.chat, { text: '❌ Please specify a group number. Use `!selectedgroups` to see selected groups.' });
            return;
          }
          
          const unselectIndex = parseInt(args[0]) - 1;
          const selectedList = this.getSelectedGroups();
          
          if (!selectedList || selectedList.length === 0) {
            await client.sendMessage(m.chat, { text: '❌ No groups currently selected. Use `!groups` to select groups first.' });
            return;
          }
          
          if (unselectIndex < 0 || unselectIndex >= selectedList.length) {
            await client.sendMessage(m.chat, { text: '❌ Invalid group number. Use `!selectedgroups` to see selected groups.' });
            return;
          }
          
          const groupToUnselect = selectedList[unselectIndex];
          if (!groupToUnselect) {
            await client.sendMessage(m.chat, { text: '❌ Invalid group selection. Please try again.' });
            return;
          }
          
          const details = this.getGroupDetails(groupToUnselect);
          
          if (this.removeGroupFromSelection(groupToUnselect)) {
            const name = details ? details.name : 'Unknown Group';
            await client.sendMessage(m.chat, { text: `❌ Removed *${name}* from selected groups.` });
          } else {
            await client.sendMessage(m.chat, { text: '❌ Failed to unselect group.' });
          }
          break;

        case '!cleargroups':
          if (this.clearSelection()) {
            await client.sendMessage(m.chat, { text: '🗑️ Cleared all selected groups. Bot will now post to all groups.' });
          } else {
            await client.sendMessage(m.chat, { text: '❌ Failed to clear group selection.' });
          }
          break;

        default:
          return false;
      }
      
      return true;
    } catch (error) {
      console.error('❌ Error handling group command:', error.message);
      await client.sendMessage(m.chat, { text: '❌ An error occurred while processing the group command.' });
      return false;
    }
  }
}

module.exports = GroupManager;