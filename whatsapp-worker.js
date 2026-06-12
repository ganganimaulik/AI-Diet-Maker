const logsBuffer = [];
const originalLog = console.log;
const originalError = console.error;

console.log = function(...args) {
  const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' ');
  logsBuffer.push(`[LOG] [${new Date().toISOString()}] ${message}`);
  if (logsBuffer.length > 200) logsBuffer.shift();
  originalLog.apply(console, args);
};

console.error = function(...args) {
  const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' ');
  logsBuffer.push(`[ERROR] [${new Date().toISOString()}] ${message}`);
  if (logsBuffer.length > 200) logsBuffer.shift();
  originalError.apply(console, args);
};

const { Client, RemoteAuth } = require('whatsapp-web.js');
const mongoose = require('mongoose');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');

class CustomMongoStore {
  constructor({ mongoose, dataPath } = {}) {
    if (!mongoose) throw new Error('A valid Mongoose instance is required for CustomMongoStore.');
    this.mongoose = mongoose;
    this.dataPath = path.resolve(dataPath || './.wwebjs_auth');
    if (!fs.existsSync(this.dataPath)) {
      fs.mkdirSync(this.dataPath, { recursive: true });
    }
  }

  async sessionExists(options) {
    let multiDeviceCollection = this.mongoose.connection.db.collection(`whatsapp-${options.session}.files`);
    let hasExistingSession = await multiDeviceCollection.countDocuments();
    return !!hasExistingSession;   
  }
  
  async save(options) {
    var bucket = new this.mongoose.mongo.GridFSBucket(this.mongoose.connection.db, {
      bucketName: `whatsapp-${options.session}`
    });
    const zipPath = path.join(this.dataPath, `${options.session}.zip`);
    await new Promise((resolve, reject) => {
      fs.createReadStream(zipPath)
        .pipe(bucket.openUploadStream(`${options.session}.zip`))
        .on('error', err => reject(err))
        .on('close', () => resolve());
    });
    options.bucket = bucket;
    await this.deletePrevious(options);
  }

  async extract(options) {
    var bucket = new this.mongoose.mongo.GridFSBucket(this.mongoose.connection.db, {
      bucketName: `whatsapp-${options.session}`
    });
    const dir = path.dirname(options.path);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return new Promise((resolve, reject) => {
      bucket.openDownloadStreamByName(`${options.session}.zip`)
        .pipe(fs.createWriteStream(options.path))
        .on('error', err => reject(err))
        .on('close', () => resolve());
    });
  }

  async delete(options) {
    var bucket = new this.mongoose.mongo.GridFSBucket(this.mongoose.connection.db, {
      bucketName: `whatsapp-${options.session}`
    });
    const documents = await bucket.find({
      filename: `${options.session}.zip`
    }).toArray();

    for (const doc of documents) {
      await bucket.delete(doc._id);
    }
  }

  async deletePrevious(options) {
    const documents = await options.bucket.find({
      filename: `${options.session}.zip`
    }).toArray();
    if (documents.length > 1) {
      const oldSession = documents.reduce((a, b) => a.uploadDate < b.uploadDate ? a : b);
      await options.bucket.delete(oldSession._id);   
    }
  }
}

async function resetWhatsAppSession() {
  console.log('Resetting WhatsApp session in DB & local cache...');
  try {
    if (store) {
      await store.delete({ session: 'session' });
      console.log('Deleted remote WhatsApp session from GridFS.');
    }
  } catch (err) {
    console.error('Failed to delete remote WhatsApp session:', err);
  }
  
  // Clear local directory
  const localPath = path.resolve('./.wwebjs_auth');
  if (fs.existsSync(localPath)) {
    try {
      fs.rmSync(localPath, { recursive: true, force: true });
      console.log('Deleted local .wwebjs_auth directory.');
    } catch (err) {
      console.error('Failed to delete local .wwebjs_auth directory:', err);
    }
  }
}

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('CRITICAL ERROR: MONGODB_URI environment variable is missing.');
  process.exit(1);
}

// -------------------------------------------------------------
// SCHEMAS DEFINITION
// -------------------------------------------------------------
const WhatsAppStateSchema = new mongoose.Schema({
  status: { type: String, enum: ['disconnected', 'connecting', 'qr_code', 'ready'], default: 'disconnected' },
  qr: { type: String, default: '' },
  connectedPhone: { type: String, default: '' },
  connectedName: { type: String, default: '' }
}, { timestamps: true });

const ContactSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: { type: String, default: '' },
  isGroup: { type: Boolean, default: false }
}, { timestamps: true });

const SchedulerSchema = new mongoose.Schema({
  isEnabled: { type: Boolean, default: false },
  targetTime: { type: String, default: '07:30' },
  timezone: { type: String, default: 'Asia/Kolkata' },
  recipientType: { type: String, enum: ['contact', 'group'], default: 'contact' },
  recipientId: { type: String, default: '' },
  recipientName: { type: String, default: '' },
  lastSentDate: { type: String, default: '' },
  lastError: { type: String, default: '' },
  retryCount: { type: Number, default: 0 },
  nextRetryTime: { type: Number, default: 0 },
  triggerTest: { type: Boolean, default: false }
}, { timestamps: true });

const ConfigSchema = new mongoose.Schema({
  apiKey: { type: String, default: '' },
  provider: { type: String, default: 'google-ai-studio' },
  enterpriseAuthMethod: { type: String, default: 'api-key' },
  enterpriseApiKey: { type: String, default: '' },
  enterpriseProjectId: { type: String, default: '' },
  enterpriseLocation: { type: String, default: 'global' },
  enterpriseServiceAccountJson: { type: String, default: '' },
  model: { type: String, default: 'gemini-3.5-flash' },
  customModel: { type: String, default: 'gemini-3.5-flash' },
  thinkingEnabled: { type: Boolean, default: true },
  thinkingBudget: { type: Number, default: 2048 },
  global: {
    dailyCalorieTarget: { type: Number, default: 1600 },
    totalOliveOil: { type: Number, default: 18 },
    oliveOilSplitPercent: { type: Number, default: 50 }
  },
  meals: Array,
  customSplits: Array,
  dailyVariables: Map,
  generationRange: { type: String, default: 'all' },
  selectedGenerationDay: { type: String, default: 'MONDAY' },
  huggingFaceToken: { type: String, default: '' },
  huggingFaceSpace: { type: String, default: 'ganganimaulik/diet-maker-worker' }
}, { timestamps: true });

const WhatsAppState = mongoose.models.WhatsAppState || mongoose.model('WhatsAppState', WhatsAppStateSchema);
const Contact = mongoose.models.Contact || mongoose.model('Contact', ContactSchema);
const Scheduler = mongoose.models.Scheduler || mongoose.model('Scheduler', SchedulerSchema);
const Config = mongoose.models.Config || mongoose.model('Config', ConfigSchema);

// -------------------------------------------------------------
// INITIALIZE DATABASE & WORKER
// -------------------------------------------------------------
let client;
let store;
console.log('Connecting to MongoDB...');
mongoose.connect(MONGODB_URI, { bufferCommands: false }).then(async () => {
  console.log('Connected to MongoDB successfully.');
  
  // Reset connection state on startup
  await WhatsAppState.findOneAndUpdate(
    {},
    { status: 'disconnected', qr: '', connectedPhone: '', connectedName: '' },
    { upsert: true }
  );

  store = new CustomMongoStore({ mongoose: mongoose, dataPath: './.wwebjs_auth' });
  
  // Determine puppeteer executable path
  let executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (!executablePath) {
    if (process.platform === 'linux') {
      executablePath = '/usr/bin/chromium';
    } else if (process.platform === 'darwin') {
      const macChromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
      if (fs.existsSync(macChromePath)) {
        executablePath = macChromePath;
      }
    }
  }
  
  console.log(`Initializing WhatsApp Client (Chrome Path: ${executablePath || 'default'})...`);

  // Build puppeteer args dynamically based on platform
  const puppeteerArgs = [
    '--no-sandbox', 
    '--disable-setuid-sandbox', 
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-blink-features=AutomationControlled',
    '--disable-features=IsolateOrigins,site-per-process',
    '--disable-web-security',
    '--no-first-run',
    '--no-default-browser-check'
  ];

  // Avoid --single-process as it causes crashes/timeouts in many Docker containers
  if (process.platform !== 'darwin') {
    puppeteerArgs.push('--no-zygote');
  }

  client = new Client({
    authStrategy: new RemoteAuth({
      store: store,
      backupSyncIntervalMs: 120000 // Backup session to DB every 2 mins
    }),
    webVersionCache: {
      type: 'remote',
      remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/{version}.html',
      strict: false
    },
    puppeteer: {
      executablePath: executablePath,
      headless: true,
      args: puppeteerArgs,
      protocolTimeout: 180000, // Wait up to 3 mins for Puppeteer protocol calls
      timeout: 180000, // Page navigation timeout: 3 mins (default 30s is too short for HF Spaces)
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
    }
  });

  client.on('remote_session_saved', () => {
    console.log('WhatsApp Remote Session saved to MongoDB store successfully.');
  });

  // -------------------------------------------------------------
  // WHATSAPP EVENT HANDLERS
  // -------------------------------------------------------------
  client.on('qr', async (qr) => {
    console.log('WhatsApp QR Code generated.');
    try {
      const dataUrl = await qrcode.toDataURL(qr);
      await WhatsAppState.findOneAndUpdate(
        {},
        { status: 'qr_code', qr: dataUrl, connectedPhone: '', connectedName: '' },
        { upsert: true }
      );
    } catch (err) {
      console.error('Failed to generate QR data URL:', err);
    }
  });

  let isClientReady = false;

  client.on('ready', async () => {
    if (isClientReady) {
      console.log('WhatsApp Client is READY (already processed, skipping duplicate event).');
      return;
    }
    isClientReady = true;
    console.log('WhatsApp Client is READY!');
    const phone = client.info.wid.user;
    const name = client.info.pushname || 'Connected Device';
    
    await WhatsAppState.findOneAndUpdate(
      {},
      { status: 'ready', qr: '', connectedPhone: phone, connectedName: name },
      { upsert: true }
    );

    // Sync Contacts in the background
    syncContacts(client);

    // Force an initial backup after the session stabilizes (60 seconds)
    // This ensures that even if sessionExists was true on startup, we save the refreshed/updated session.
    setTimeout(async () => {
      try {
        if (client && client.authStrategy && typeof client.authStrategy.storeRemoteSession === 'function') {
          console.log('Forcing initial WhatsApp session backup to MongoDB store...');
          await client.authStrategy.storeRemoteSession();
          console.log('Initial WhatsApp session backup completed.');
        }
      } catch (err) {
        console.error('Failed to run initial forced session backup:', err);
      }
    }, 60000);
  });

  client.on('disconnected', async (reason) => {
    console.log('WhatsApp Client disconnected. Reason:', reason);
    isClientReady = false;
    await resetWhatsAppSession();
    await WhatsAppState.findOneAndUpdate(
      {},
      { status: 'disconnected', qr: '', connectedPhone: '', connectedName: '' },
      { upsert: true }
    );
    console.log('Exiting worker process to restart and generate new QR code...');
    setTimeout(() => {
      process.exit(1);
    }, 2000);
  });

  client.on('auth_failure', async (msg) => {
    console.error('WhatsApp Authentication Failure:', msg);
    await resetWhatsAppSession();
    await WhatsAppState.findOneAndUpdate(
      {},
      { status: 'disconnected', qr: '', connectedPhone: '', connectedName: '' },
      { upsert: true }
    );
    console.log('Exiting worker process to restart and generate new QR code...');
    setTimeout(() => {
      process.exit(1);
    }, 2000);
  });

  client.on('loading_screen', (percent, message) => {
    console.log(`WhatsApp Client Loading: ${percent}% - ${message}`);
  });

  // Initialize with retry logic (exponential backoff)
  const MAX_INIT_RETRIES = 5;
  const BASE_RETRY_DELAY_MS = 30000; // 30 seconds

  async function initializeWithRetry(attempt = 1) {
    try {
      console.log(`WhatsApp client initialization attempt ${attempt}/${MAX_INIT_RETRIES}...`);
      await client.initialize();
      console.log('WhatsApp client initialized successfully.');
    } catch (err) {
      console.error(`Failed to initialize WhatsApp client (attempt ${attempt}/${MAX_INIT_RETRIES}):`, err);

      if (attempt >= MAX_INIT_RETRIES) {
        console.error(`All ${MAX_INIT_RETRIES} initialization attempts failed. Restarting worker process...`);
        // Update state in DB so the frontend knows
        try {
          await WhatsAppState.findOneAndUpdate(
            {},
            { status: 'disconnected', qr: '', connectedPhone: '', connectedName: '' },
            { upsert: true }
          );
        } catch (_) {}
        setTimeout(() => process.exit(1), 2000);
        return;
      }

      // Destroy any leftover browser instance before retrying
      try {
        if (client.pupBrowser) {
          await client.pupBrowser.close();
        }
      } catch (_) {}

      const delay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt - 1); // 30s, 60s, 120s, 240s, 480s
      console.log(`Retrying in ${delay / 1000} seconds...`);
      setTimeout(() => initializeWithRetry(attempt + 1), delay);
    }
  }

  initializeWithRetry();

  // Start Scheduler Loop (check every 60 seconds)
  setInterval(() => {
    schedulerCheck(client);
  }, 60000);

}).catch(err => {
  console.error('Failed to connect to MongoDB:', err);
  process.exit(1);
});

// -------------------------------------------------------------
// SYNC WHATSAPP CONTACTS TO MONGODB
// -------------------------------------------------------------
async function syncContacts(client) {
  try {
    console.log('Fetching WhatsApp chats to cache contacts...');
    const chats = await client.getChats();
    console.log(`Fetched ${chats.length} chats. Syncing to database...`);
    
    for (const chat of chats) {
      if (chat.id && chat.name) {
        await Contact.findOneAndUpdate(
          { id: chat.id._serialized },
          { name: chat.name, isGroup: chat.isGroup },
          { upsert: true }
        );
      }
    }
    console.log('WhatsApp contacts synced successfully.');
  } catch (err) {
    console.error('Failed to sync contacts:', err);
  }
}

// -------------------------------------------------------------
// SCHEDULER CHECK & EXECUTION
// -------------------------------------------------------------
async function schedulerCheck(client) {
  try {
    const scheduler = await Scheduler.findOne();
    if (!scheduler) return;

    // 1. Check if a manual Test Send was triggered
    if (scheduler.triggerTest) {
      console.log('Manual Test Send triggered.');
      // Instantly reset the flag in DB so we don't double-trigger
      await Scheduler.findOneAndUpdate({}, { $set: { triggerTest: false } });
      await executeScheduledSend(client, scheduler, true);
      return;
    }

    // 2. Check if automated sending is enabled
    if (!scheduler.isEnabled) return;

    // 3. Verify recipient configurations
    if (!scheduler.recipientId) {
      console.warn('Daily Scheduler enabled but recipientId is missing.');
      return;
    }

    // 4. Check time and date conditions
    const now = new Date();
    const timezone = scheduler.timezone || 'Asia/Kolkata';
    
    // Format local date: YYYY-MM-DD in target timezone
    const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    
    // Format local time: HH:MM in target timezone
    const localTime = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
    
    const [targetHour, targetMinute] = scheduler.targetTime.split(':');
    const [currHour, currMinute] = localTime.split(':');

    // If already sent today, skip
    if (scheduler.lastSentDate === localDate) return;

    // Check if current time is past/equal target time
    const isPastTargetTime = (parseInt(currHour) > parseInt(targetHour)) || 
                             (parseInt(currHour) === parseInt(targetHour) && parseInt(currMinute) >= parseInt(targetMinute));

    // Enforce sending window: only between 03:00 and 08:30
    const currHourInt = parseInt(currHour);
    const currMinuteInt = parseInt(currMinute);
    const currTotalMinutes = currHourInt * 60 + currMinuteInt;
    const windowStart = 3 * 60;       // 03:00 = 180 minutes
    const windowEnd = 8 * 60 + 30;    // 08:30 = 510 minutes
    const isWithinWindow = currTotalMinutes >= windowStart && currTotalMinutes <= windowEnd;

    if (!isWithinWindow) {
      // Outside the allowed window — do not send
      if (isPastTargetTime && currTotalMinutes > windowEnd) {
        console.log(`Cook message window (03:00–08:30) has passed. Current: ${localTime}. Skipping for today.`);
      }
      return;
    }

    if (isPastTargetTime) {
      // Check if we are in a retry cool-down
      if (scheduler.retryCount > 0 && Date.now() < scheduler.nextRetryTime) {
        // Still cooling down from previous failure
        return;
      }

      console.log(`Time match detected! Target: ${scheduler.targetTime}. Current: ${localTime}. Executing scheduled delivery...`);
      await executeScheduledSend(client, scheduler, false);
    }
  } catch (err) {
    console.error('Error in scheduler check loop:', err);
  }
}

// -------------------------------------------------------------
// CORE GENERATION & WHATSAPP TRANSMISSION
// -------------------------------------------------------------
async function executeScheduledSend(client, scheduler, isTest = false) {
  const now = new Date();
  const timezone = scheduler.timezone || 'Asia/Kolkata';
  const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  
  try {
    // 1. Verify WhatsApp client is connected
    const state = await WhatsAppState.findOne();
    if (!state || state.status !== 'ready') {
      throw new Error('WhatsApp client is not connected / authenticated.');
    }

    // Verify recipient is configured in the scheduler
    if (!scheduler.recipientId) {
      throw new Error('Recipient JID (ID) is not configured in the scheduler.');
    }

    // 2. Fetch active diet configuration
    const configDoc = await Config.findOne();
    if (!configDoc) {
      throw new Error('Diet configuration is missing.');
    }
    const hasEnterpriseCreds = configDoc.provider === 'gemini-enterprise' && (
      configDoc.enterpriseAuthMethod === 'adc' ||
      (configDoc.enterpriseAuthMethod === 'api-key' && (process.env.GEMINI_API_KEY || process.env.API_KEY || configDoc.enterpriseApiKey)) ||
      (configDoc.enterpriseAuthMethod === 'service-account' && configDoc.enterpriseServiceAccountJson)
    );
    const hasStudioCreds = configDoc.provider !== 'gemini-enterprise' && (process.env.GEMINI_API_KEY || process.env.API_KEY || configDoc.apiKey);
    if (!hasEnterpriseCreds && !hasStudioCreds) {
      throw new Error('Gemini API Key or credentials are missing.');
    }

    // 3. Compile prompt for TODAY
    const todayName = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'long' }).format(now).toUpperCase(); // e.g. "SATURDAY"
    
    console.log(`Compiling diet prompt for today (${todayName})...`);
    const prompt = compilePromptTextForDay(configDoc, todayName);

    // 4. Call Gemini API
    console.log('Generating diet plan from Gemini...');
    const generatedText = await callGeminiAPI(configDoc, prompt);
    
    // 5. Extract Part 2 (Cook instructions)
    const messageToSend = extractCookInstructions(generatedText, todayName);

    // 6. Transmit message
    console.log(`Sending WhatsApp message to ${scheduler.recipientName || scheduler.recipientId}...`);
    await client.sendMessage(scheduler.recipientId, messageToSend);
    console.log('WhatsApp message sent successfully!');

    // 7. Update scheduler states on Success
    if (!isTest) {
      await Scheduler.findOneAndUpdate(
        {},
        {
          $set: {
            lastSentDate: localDate,
            lastError: '',
            retryCount: 0,
            nextRetryTime: 0
          }
        }
      );
    } else {
      console.log('Test send execution completed successfully.');
    }
  } catch (error) {
    console.error('Failed to execute scheduled send:', error);
    
    if (!isTest) {
      // Set retry fields: retry in 30 minutes
      const retryCount = (scheduler.retryCount || 0) + 1;
      const nextRetryTime = Date.now() + 30 * 60 * 1000; // 30 minutes in the future
      
      await Scheduler.findOneAndUpdate(
        {},
        {
          $set: {
            lastError: error.message || 'Unknown error',
            retryCount: retryCount,
            nextRetryTime: nextRetryTime
          }
        }
      );
      console.log(`Scheduler updated with retry status. Attempt #${retryCount}. Next retry: ${new Date(nextRetryTime).toLocaleTimeString()}`);
    }
  }
}

// Helper: Compile single-day prompt
function compilePromptTextForDay(c, dayName) {
  const mealsList = c.meals || [];
  let splitsList = c.customSplits || [];
  
  if (splitsList.length === 0) {
    if (c.splits) {
      splitsList = [
        { id: 'salt', name: 'Salt Seasoning Split', value: c.splits.saltSplit || '8g in subji. 7g in chicken with 1 liter water. 3g in marinate paste' },
        { id: 'prep', name: 'Chicken Prep Method', value: c.splits.chickenPrepMethod || 'Chicken air fryer 200c, 15 min' }
      ];
    } else {
      splitsList = [
        { id: 'salt', name: 'Salt Seasoning Split', value: '8g in subji. 7g in chicken with 1 liter water. 3g in marinate paste' },
        { id: 'prep', name: 'Chicken Prep Method', value: 'Chicken air fryer 200c, 15 min' }
      ];
    }
  }
  
  const totalOil = c.global.totalOliveOil || 0;
  const oilPercent = c.global.oliveOilSplitPercent || 50;
  const subjiOil = Math.round(totalOil * oilPercent / 100);
  const chickenOil = totalOil - subjiOil;

  const splitsText = [
    `Olive Oil Cooking Split: ${subjiOil}g in subji. ${chickenOil}g in chicken`,
    ...splitsList.map(s => `${s.name}: ${s.value}`)
  ].map(s => `- ${s}`).join('\n');

  const mealsTargetText = mealsList
    .map((meal, idx) => `- Meal ${idx + 1} (${meal.name}): eaten ${meal.mealsPerDay} times per day`)
    .join('\n');

  const mealsDetailsText = mealsList
    .map((meal, idx) => `
[MEAL ${idx + 1} WEIGHTS: ${meal.name} (FOR 1 MEAL)]
${meal.ingredients.map(ing => `- ${ing.name}: ${ing.isAuto ? '[AUTO]' : `${ing.weight}g`}`).join('\n')}
${meal.water ? `- liquids: ${meal.water}` : ''}
${meal.prepMethod ? `- prep method: ${meal.prepMethod}` : ''}
`).join('\n');

  // Load variables for today
  // Since dailyVariables is a Map in Mongoose schema, we fetch keys
  const dailyVariablesMap = c.dailyVariables || {};
  let todayIngredients = [];
  if (typeof dailyVariablesMap.get === 'function') {
    todayIngredients = dailyVariablesMap.get(dayName) || [];
  } else {
    todayIngredients = dailyVariablesMap[dayName] || [];
  }

  const getDayVariantName = (ingredients) => {
    const nonStapleNames = ingredients
      .filter(ing => !ing.isAuto)
      .map(ing => ing.name);
    if (nonStapleNames.length === 0) return 'Staples Only';
    if (nonStapleNames.length === 1) return `Just ${nonStapleNames[0]}`;
    return nonStapleNames.join(' + ');
  };

  const variant = getDayVariantName(todayIngredients);
  const itemsText = todayIngredients.map(ing => `${ing.name}: ${ing.isAuto ? '[AUTO]' : `${ing.weight}g`}`).join(', ');
  const dailyVariablesText = `- ${dayName} (${variant}): ${itemsText}`;

  return `Act as a strict meal prep calculator and format generator. Below is a centralized configuration section containing weights, targets, and cooking instructions. 

Your task is to automatically calculate all calories using standard nutritional values for raw/uncooked ingredients, round them to the nearest whole number, solve for any ingredients marked as \`[AUTO]\`, and generate a dual-purpose diet plan document.
- PART 1 must be a detailed macro and meal breakdown for myself (using markdown tables and your computed calories). 
- PART 2 must be a raw, copy-pasteable weekly text plan for my cook containing ONLY strict text blocks for each day with absolutely no conversational text, tables, or calorie explanations.

===================================================================
       CONFIGURABLE VARIABLES (EDIT TARGETS, WEIGHTS & SPLITS HERE)
===================================================================

[GLOBAL DIET TARGETS]
- Daily Calorie Target: ${c.global.dailyCalorieTarget} kcal
- Total Daily Olive Oil: ${c.global.totalOliveOil}g (MUST include this globally in daily calorie sum calculations)
${mealsTargetText}

${mealsDetailsText}
[COOK COOKING & SEASONING SPLITS / INSTRUCTIONS]
${splitsText}

[DAILY VARIABLE INGREDIENT WEIGHTS (WHOLE DAY)]
* Note: Use [AUTO] for any ingredient you want the calculator to dynamically scale to hit your exact Daily Calorie Target.
${dailyVariablesText}

===================================================================
                        MATH & OUTPUT GENERATION
===================================================================

INSTRUCTIONS FOR THE CALCULATOR:
1. Estimate the raw/uncooked calorie density (kcal per 1g) for each ingredient using standard USDA nutritional values (e.g. Raw Rice ≈ 3.6 kcal/g, Raw Chicken Breast ≈ 1.2 kcal/g, Olive Oil ≈ 8.75 kcal/g, Eggs ≈ 1.43 kcal/g, Butter ≈ 7.17 kcal/g, Pasta ≈ 3.55 kcal/g, Raw Oats ≈ 3.89 kcal/g, Whey Protein Isolate ≈ 3.7 kcal/g, Almonds ≈ 5.79 kcal/g, Cashews ≈ 5.53 kcal/g, Walnuts ≈ 6.54 kcal/g, Banana ≈ 0.89 kcal/g, Tomato ≈ 0.18 kcal/g, Potato (Raw) ≈ 0.77 kcal/g, Cluster Beans ≈ 0.16 kcal/g, Bottle Gourd ≈ 0.15 kcal/g, Brinjal ≈ 0.25 kcal/g, etc.).
2. For the selected day (${dayName}), sum the calculated calories of all strictly defined weights across all meals and daily variables:
   - Daily calories from meals = Sum over all meals of: (sum of calories of all ingredients in that meal) x (meals per day for that meal)
   - Daily variables calories = sum of calories of all variables for that day
   - Global Olive Oil calories = Total Daily Olive Oil x (calorie density of Olive Oil)
3. Subtract that total (meals + variables + olive oil) from the [Daily Calorie Target] to find the remaining calorie deficit.
4. Convert that remaining calorie deficit into grams for the ingredient(s) marked \`[AUTO]\` using their calorie density to determine their exact weight. 
5. If a day contains multiple \`[AUTO]\` ingredients, split the remaining deficit equally (50-50 in terms of calories) between them, then solve for each weight.
6. For each meal, divide its daily baseline weights and any daily variable weights by the meal's daily frequency to find the per-meal weight.
7. Round all final calculated weights and calories to the nearest whole number so that the day's total hits your target exactly.
8. Calculate the total daily Sodium (Na) and Potassium (K) in milligrams (mg), and their ratio (Na:K ratio) for the day:
   - Table salt (NaCl) contains approximately 388 mg of sodium per 1 g of salt.
   - Look at the "Salt Seasoning Split" split value config under cooking splits. Identify the portion that is boiled with water where chicken is boiled and then the water is thrown away (e.g., "7g in chicken with 1 liter water"). For this portion, assume that only 10% of the salt/sodium is absorbed and retained by the chicken (meaning only 0.7g of salt is consumed, while the other 90% is discarded with the water). All other salt split allocations (e.g. in subji, in marinate paste) are assumed to be 100% consumed.
   - Estimate natural sodium per 100g of raw ingredients: Raw Chicken Breast ≈ 70mg, White Rice ≈ 5mg, Potato (Raw) ≈ 6mg, Tomato ≈ 5mg, Bottle Gourd ≈ 2mg, Cluster Beans ≈ 2mg, Brinjal ≈ 2mg, Olive Oil ≈ 2mg, Eggs ≈ 140mg, Oats ≈ 2mg, Whey Protein ≈ 160mg, Nuts ≈ 1mg, Banana ≈ 1mg.
   - Estimate natural potassium per 100g of raw ingredients: Raw Chicken Breast ≈ 256mg, White Rice ≈ 115mg, Potato (Raw) ≈ 400mg, Tomato ≈ 237mg, Bottle Gourd ≈ 150mg, Cluster Beans ≈ 230mg, Brinjal ≈ 230mg, Olive Oil ≈ 1mg, Eggs ≈ 130mg, Oats ≈ 429mg, Whey Protein ≈ 350mg, Almonds/Cashews/Walnuts ≈ 600mg, Banana ≈ 358mg.
   - Compute Total Daily Sodium (mg) = Sodium from consumed salt + Natural sodium from all daily ingredients.
   - Compute Total Daily Potassium (mg) = Natural potassium from all daily ingredients.
   - Compute the Sodium-to-Potassium Ratio (Na:K Ratio) = Total Daily Sodium (mg) / Total Daily Potassium (mg) (rounded to 2 decimal places).

---

PART 1: FOR MYSELF (User Breakdown)
Generate this exact section first using markdown tables and bullet points based strictly on your calculations.

At the very top of Part 1 (above any meal breakdowns/tables), you MUST print a bolded summary block for the daily sodium and potassium levels. Format it exactly as follows:
### Daily Sodium & Potassium Summary
For the day (${dayName}):
- **${dayName}**: Total Sodium: **[X] mg** | Total Potassium: **[Y] mg** | Na:K Ratio: **[Z]**
  * (Include a brief breakdown note showing how you calculated this: e.g., "Includes [X_salt]mg sodium from consumed salt and [X_natural]mg natural sodium. Consumed salt includes 100% of [non-water-boiled splits] and only 10% of [water-boiled splits] (water discarded). Total potassium is from natural ingredients.")

${mealsList.map((meal, idx) => `
${idx + 1}. ${meal.name} (${meal.mealsPerDay} Meal${meal.mealsPerDay > 1 ? 's' : ''} Per Day)
Include a markdown table with columns: Ingredient, Weight Per Meal, Daily Total (${meal.mealsPerDay} Meal${meal.mealsPerDay > 1 ? 's' : ''}), Calories (Per Meal). Sum the total calculated calories at the bottom of the table.
`).join('\n')}

For daily variables and splits:
List out only the day ${dayName} using bullet points. Under this day, list ALL fixed items and variable items together, displaying the per-meal weight, daily weight, and calculated calorie breakdown. If an item was calculated via \`[AUTO]\`, replace the \`[AUTO]\` tag with the calculated real weights. Show a calculated "Meal Total" for the day.

Include a Daily Totals (Summary) bulleted section at the bottom of Part 1 aggregating the calculated daily sum total across all meals (and include the global Olive Oil calories) to prove it hits your configured target.

---

PART 2: FOR MY COOK (Weekly Text Plan)
Separate this from Part 1 using a horizontal rule (---). Output only the day ${dayName} using the exact line-by-line template below. Map your calculated total daily weights (including solved \`[AUTO]\` weights) and cooking splits/instructions directly. Absolutely no conversational text, tables, or calorie mentions in this section.

Exact Output Template to Follow:

### ${dayName}: ${variant}
[For each meal, list its ingredients with daily total weights in grams. Then list liquid configuration and prep methods without any hyphen or bullet point prefix. E.g.
"Meal Name:
ingredient1 name 150g
ingredient2 name 100g
liquids: 190g water
prep method: airfryer 200c, 10min"]
[List all custom splits and cooking instructions for each day here, again with no hyphen prefix]
`;
}

// Helper: Call Google Gemini API
async function callGeminiAPI(c, prompt) {
  const model = c.model === 'custom' ? c.customModel : c.model;
  
  if (c.provider === 'gemini-enterprise') {
    if (c.enterpriseAuthMethod === 'api-key') {
      const enterpriseApiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || c.enterpriseApiKey;
      if (!enterpriseApiKey) {
        throw new Error('Agent Platform API Key is required when API Key authentication is selected.');
      }
      if (!c.enterpriseProjectId) {
        throw new Error('GCP Project ID is required for Gemini Enterprise Agent Platform.');
      }

      // Build the request payload for Gemini Enterprise REST API
      const payload = {
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          temperature: 0.1,
        }
      };

      if (c.thinkingEnabled) {
        payload.generationConfig.thinkingConfig = {
          thinkingBudget: c.thinkingBudget || 2048
        };
      }

      const loc = c.enterpriseLocation || 'global';
      const host = loc === 'global' ? 'aiplatform.googleapis.com' : `${loc}-aiplatform.googleapis.com`;
      const endpoint = `https://${host}/v1/projects/${c.enterpriseProjectId}/locations/${loc}/publishers/google/models/${model}:generateContent?key=${enterpriseApiKey}`;
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini Enterprise API returned error (${response.status}): ${errorText}`);
      }

      const data = await response.json();
      const candidate = data.candidates?.[0];
      const parts = candidate?.content?.parts || [];

      let text = '';
      for (const part of parts) {
        if (!part.thought && part.text) {
          text += part.text;
        }
      }

      if (!text && parts.length > 0) {
        text = parts.map(p => p.text || '').join('');
      }

      return text;

    } else {
      // Service Account or ADC auth using @google/genai SDK
      if (c.enterpriseAuthMethod === 'service-account' && !c.enterpriseServiceAccountJson) {
        throw new Error('Service Account JSON is required when Service Account authentication is selected.');
      }
      if (!c.enterpriseProjectId) {
        throw new Error('GCP Project ID is required for Gemini Enterprise Agent Platform.');
      }

      const { GoogleGenAI } = require('@google/genai');

      let googleAuthOptions = undefined;
      if (c.enterpriseAuthMethod === 'service-account') {
        try {
          googleAuthOptions = {
            credentials: JSON.parse(c.enterpriseServiceAccountJson)
          };
        } catch (err) {
          throw new Error(`Invalid Service Account JSON: ${err.message}`);
        }
      }

      const ai = new GoogleGenAI({
        vertexai: true,
        project: c.enterpriseProjectId,
        location: c.enterpriseLocation || 'global',
        googleAuthOptions
      });

      const configObj = {
        temperature: 0.1,
      };

      if (c.thinkingEnabled) {
        configObj.thinkingConfig = {
          thinkingBudget: c.thinkingBudget || 2048
        };
      }

      const sdkResponse = await ai.models.generateContent({
        model: model,
        contents: prompt,
        config: configObj
      });

      const candidate = sdkResponse.candidates?.[0];
      const parts = candidate?.content?.parts || [];

      let text = '';
      for (const part of parts) {
        if (!part.thought && part.text) {
          text += part.text;
        }
      }

      if (!text && parts.length > 0) {
        text = parts.map(p => p.text || '').join('');
      }

      return text;
    }
  } else {
    // Default: Google AI Studio API
    const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || c.apiKey;
    if (!apiKey) {
      throw new Error('Gemini API Key is missing.');
    }

    const payload = {
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        temperature: 0.1,
      }
    };

    if (c.thinkingEnabled) {
      payload.generationConfig.thinkingConfig = {
        thinkingBudget: c.thinkingBudget || 2048
      };
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API returned error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    
    let text = '';
    for (const part of parts) {
      if (!part.thought && part.text) {
        text += part.text;
      }
    }

    if (!text && parts.length > 0) {
      text = parts.map(p => p.text || '').join('');
    }

    return text;
  }
}

// Helper: Extract Part 2 (Cook Instructions) from response markdown
function extractCookInstructions(md, dayName) {
  if (!md) return `No plan generated for ${dayName}.`;

  const splitRegex = /(?:###?\s*)?PART\s*2:\s*FOR\s*MY\s*COOK[^\n]*/i;
  const match = md.match(splitRegex);
  
  let part2 = '';
  if (match && match.index !== undefined) {
    part2 = md.substring(match.index + match[0].length).trim();
    if (part2.startsWith('---')) {
      part2 = part2.substring(3).trim();
    }
  } else {
    // Fallback: split by last horizontal rule
    const sections = md.split('---');
    if (sections.length > 1) {
      part2 = sections[sections.length - 1].trim();
    } else {
      part2 = md.trim();
    }
  }

  return part2;
}

// -------------------------------------------------------------
// HTTP HEALTH CHECK SERVER FOR HUGGING FACE SPACES
// -------------------------------------------------------------
const http = require('http');
const net = require('net');

function checkTcp(host, port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const start = Date.now();
    socket.setTimeout(4000);
    
    socket.on('connect', () => {
      socket.destroy();
      resolve({ success: true, timeMs: Date.now() - start });
    });
    
    socket.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });
    
    socket.on('timeout', () => {
      socket.destroy();
      resolve({ success: false, error: 'timeout' });
    });
    
    socket.connect(port, host);
  });
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = req.url || '';
  if (parsedUrl.startsWith('/diag')) {
    try {
      const googleDiag = await checkTcp('google.com', 443);
      const whatsappDiag = await checkTcp('web.whatsapp.com', 443);
      
      res.writeHead(200, { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify({
        google: googleDiag,
        whatsapp: whatsappDiag,
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Diagnostic Error: ' + err.message);
    }
    return;
  }

  if (parsedUrl.startsWith('/logs')) {
    res.writeHead(200, { 
      'Content-Type': 'text/plain; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(logsBuffer.join('\n'));
    return;
  }

  if (parsedUrl.startsWith('/reset')) {
    try {
      res.writeHead(200, { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify({ success: true, message: 'Resetting WhatsApp worker...' }));
      
      // Perform reset and restart worker
      (async () => {
        console.log('Manual reset requested via HTTP api.');
        await resetWhatsAppSession();
        await WhatsAppState.findOneAndUpdate(
          {},
          { status: 'disconnected', qr: '', connectedPhone: '', connectedName: '' },
          { upsert: true }
        );
        if (client) {
          try {
            await client.destroy();
          } catch (e) {}
        }
        console.log('Exiting worker process after manual reset...');
        setTimeout(() => {
          process.exit(1);
        }, 1000);
      })();
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Reset Error: ' + err.message);
    }
    return;
  }

  try {
    const stateDoc = await WhatsAppState.findOne();
    const schedulerDoc = await Scheduler.findOne();
    
    res.writeHead(200, { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*' // Allow Vercel frontend to query if needed
    });
    
    res.end(JSON.stringify({ 
      status: 'online', 
      worker: 'whatsapp-worker', 
      whatsapp: stateDoc ? stateDoc.status : 'unknown',
      scheduler: schedulerDoc ? { enabled: schedulerDoc.isEnabled, lastSent: schedulerDoc.lastSentDate } : 'unknown'
    }));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal Server Error: ' + e.message);
  }
});

const PORT = process.env.PORT || 7860;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`HTTP Health check server is listening on port ${PORT}`);
});

// -------------------------------------------------------------
// GRACEFUL SHUTDOWN HANDLERS
// -------------------------------------------------------------
let isShuttingDown = false;

async function handleShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`Received ${signal}. Gracefully shutting down WhatsApp client...`);
  
  try {
    if (mongoose.connection.readyState !== 0) {
      // Reset status in database to disconnected on graceful shutdown
      await WhatsAppState.findOneAndUpdate(
        {},
        { status: 'disconnected', qr: '' }
      );
    }
  } catch (err) {
    console.error('Failed to reset WhatsApp state in database during shutdown:', err);
  }

  try {
    if (typeof client !== 'undefined' && client) {
      console.log('Closing WhatsApp browser connection to release file locks...');
      await client.destroy();
      console.log('WhatsApp client destroyed.');
      
      if (client.authStrategy && typeof client.authStrategy.storeRemoteSession === 'function') {
        console.log('Saving final WhatsApp session to MongoDB...');
        await client.authStrategy.storeRemoteSession();
        console.log('Final WhatsApp session saved successfully.');
      }
    }
  } catch (err) {
    console.error('Error during graceful shutdown of WhatsApp client:', err);
  } finally {
    try {
      if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
        console.log('MongoDB connection closed.');
      }
    } catch (dbErr) {
      console.error('Error closing MongoDB connection:', dbErr);
    }
    process.exit(0);
  }
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));

// -------------------------------------------------------------
// CATCH UNHANDLED PROMISE REJECTIONS (e.g. RemoteAuth "auth timeout")
// -------------------------------------------------------------
process.on('unhandledRejection', (reason, promise) => {
  const reasonStr = typeof reason === 'string' ? reason : (reason && reason.message) || String(reason);
  console.error('Unhandled Promise Rejection caught:', reasonStr);

  if (reasonStr.includes('auth timeout')) {
    // This is a stale timeout from RemoteAuth internals that fires even after
    // the client has already authenticated and reached the "ready" state.
    // It is safe to ignore — the session is valid and working.
    console.warn('RemoteAuth "auth timeout" detected — this is a known spurious error. Client is already authenticated. Ignoring.');
  } else {
    console.error('Unhandled rejection (non-auth):', reason);
  }
});
