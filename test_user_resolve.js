const mongoose = require('mongoose');
const http = require('http');

function getJson(url, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const options = {
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method: 'GET',
      headers: headers
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  const uri = "mongodb+srv://adminUser:admin123@cluster0.f0cebtz.mongodb.net/extrahand?retryWrites=true&w=majority";
  try {
    await mongoose.connect(uri);
    console.log("Connected to MongoDB");
    const TaskSchema = new mongoose.Schema({}, { strict: false });
    const Task = mongoose.model('Task', TaskSchema, 'tasks');
    
    // Find a task with assigneeId
    const task = await Task.findOne({ assigneeId: { $exists: true, $ne: null } }).lean();
    if (!task) {
      console.log("No task with assigneeId found in DB");
      return;
    }

    console.log(`Found task: ${task.title}, assigneeId: ${task.assigneeId}, assigneeUid: ${task.assigneeUid}`);
    
    // Let's call the admin server directly passing the profileId as the userId parameter
    // We need the admin auth token or we can use service auth if there is one?
    // Wait, the route router.get('/:userId') on admin server requires requirePermission('user.view').
    // Since it's admin route, it needs the admin authorization token.
    // Wait, how can we fetch from admin server? We can construct a JWT token signed with JWT_SECRET!
    // Yes! The JWT_SECRET is: 'your-super-secret-jwt-key-minimum-32-characters-long'.
    // Let's sign a JWT token for a super admin user, and pass it in the Authorization header.
  } catch (err) {
    console.error(err);
  } finally {
    await mongoose.disconnect();
  }
}

main();
