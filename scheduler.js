require('dotenv').config();
const { postToAllGroups } = require('./main');

class BotScheduler {
  constructor() {
    this.autoPostEnabled = process.env.AUTO_POST_ENABLED === 'true';
    this.postIntervalHours = parseInt(process.env.POST_INTERVAL_HOURS) || 24;
    this.postTimeHour = parseInt(process.env.POST_TIME_HOUR) || 9;
    this.postTimeMinute = parseInt(process.env.POST_TIME_MINUTE) || 0;
    this.intervalId = null;
    this.timeoutId = null;
    this.client = null;
    this.isRunning = false;
  }

  setClient(client) {
    this.client = client;
  }

  start() {
    if (!this.client) {
      console.error('❌ Cannot start scheduler: WhatsApp client not set');
      return;
    }

    if (!this.autoPostEnabled) {
      console.log('⏸️ Auto-posting is disabled in configuration');
      return;
    }

    if (this.isRunning) {
      console.log('⚠️ Scheduler is already running');
      return;
    }

    this.isRunning = true;
    console.log(`🕐 Starting scheduler: posting every ${this.postIntervalHours} hours at ${this.postTimeHour}:${this.postTimeMinute.toString().padStart(2, '0')}`);

    // Schedule the first post
    this.scheduleNextPost();
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    this.isRunning = false;
    console.log('⏹️ Scheduler stopped');
  }

  scheduleNextPost() {
    const now = new Date();
    const nextPost = this.calculateNextPostTime();
    const delay = nextPost.getTime() - now.getTime();

    console.log(`⏰ Next post scheduled for: ${nextPost.toLocaleString()}`);

    this.timeoutId = setTimeout(async () => {
      await this.executePost();
      
      // Schedule the next post after this one completes
      if (this.isRunning) {
        this.scheduleNextPost();
      }
    }, delay);
  }

  calculateNextPostTime() {
    const now = new Date();
    const nextPost = new Date();
    
    nextPost.setHours(this.postTimeHour, this.postTimeMinute, 0, 0);
    
    // If the time has already passed today, schedule for tomorrow
    if (nextPost <= now) {
      nextPost.setDate(nextPost.getDate() + 1);
    }
    
    return nextPost;
  }

  async executePost() {
    try {
      console.log('🚀 Executing scheduled post...');
      await postToAllGroups(this.client);
      console.log('✅ Scheduled post completed successfully');
    } catch (error) {
      console.error('❌ Error during scheduled post:', error.message);
    }
  }

  // Manual trigger for immediate posting
  async triggerManualPost(selectedGroupIds = null) {
    if (!this.client) {
      console.error('❌ Cannot trigger manual post: WhatsApp client not set');
      return false;
    }

    try {
      console.log('🔄 Triggering manual post...');
      await postToAllGroups(this.client, selectedGroupIds);
      console.log('✅ Manual post completed successfully');
      return true;
    } catch (error) {
      console.error('❌ Error during manual post:', error.message);
      return false;
    }
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      autoPostEnabled: this.autoPostEnabled,
      postIntervalHours: this.postIntervalHours,
      postTime: `${this.postTimeHour}:${this.postTimeMinute.toString().padStart(2, '0')}`,
      nextPost: this.isRunning ? this.calculateNextPostTime().toLocaleString() : null
    };
  }
}

module.exports = BotScheduler;