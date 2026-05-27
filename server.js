const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3000;
const JWT_SECRET = 'my-secret-key-2024';
const DB_PATH = path.join(__dirname, 'database');

// ==================== DATABASE FUNCTIONS ====================
function readDB(filename) {
    const filePath = path.join(DB_PATH, filename);
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, '[]');
        return [];
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function writeDB(filename, data) {
    fs.writeFileSync(path.join(DB_PATH, filename), JSON.stringify(data, null, 2));
}

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

// ==================== AUTO SETUP ADMIN ====================
function autoSetup() {
    const admins = readDB('admins.json');
    if (admins.length === 0) {
        admins.push({
            id: generateId(),
            username: 'admin',
            password: bcrypt.hashSync('admin123', 10),
            shopName: 'My Shop',
            createdAt: new Date().toISOString()
        });
        writeDB('admins.json', admins);
        console.log('✅ Admin created: admin / admin123');
    } else {
        admins[0].password = bcrypt.hashSync('admin123', 10);
        writeDB('admins.json', admins);
        console.log('✅ Admin synced: admin / admin123');
    }
}

// ==================== 🔥 AUTO LOCK CHECKER ====================
function autoLockCheck() {
    const devices = readDB('devices.json');
    const now = new Date();
    let lockedCount = 0;

    devices.forEach(device => {
        // শুধু active ডিভাইস চেক
        if (device.status === 'active' && !device.locked) {
            const dueDate = new Date(device.nextDueDate);
            
            // 🔥 যদি আজকের তারিখ due date পার হয়ে যায়
            if (now >= dueDate) {
                device.locked = true;
                device.status = 'locked';
                device.lockReason = 'Payment overdue. Due date: ' + device.nextDueDate;
                device.lockDate = now.toISOString();
                lockedCount++;
                console.log(`🔒 Auto-locked: ${device.imei} (Due: ${device.nextDueDate})`);
            }
        }
    });

    if (lockedCount > 0) {
        writeDB('devices.json', devices);
        console.log(`🔒 Total auto-locked: ${lockedCount} devices`);
    }
}

// 🔥 প্রতি ১ মিনিটে অটো লক চেক
setInterval(() => {
    autoLockCheck();
}, 60000); // 60 seconds

// প্রথমবার চেক
autoLockCheck();

// ==================== MIDDLEWARE ====================
function auth(req, res, next) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ message: 'No token' });
    try {
        req.admin = jwt.verify(token, JWT_SECRET);
        next();
    } catch (e) {
        res.status(401).json({ message: 'Invalid token' });
    }
}

// ==================== ROUTES ====================

// Login
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    const admins = readDB('admins.json');
    const admin = admins.find(a => a.username === username);
    
    if (!admin) {
        return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    
    const isMatch = bcrypt.compareSync(password, admin.password);
    if (!isMatch) {
        admin.password = bcrypt.hashSync('admin123', 10);
        writeDB('admins.json', admins);
        return res.status(401).json({ success: false, message: 'Password reset. Try admin123' });
    }
    
    const token = jwt.sign({ id: admin.id, username: admin.username }, JWT_SECRET, { expiresIn: '365d' });
    res.json({ success: true, token, admin: { id: admin.id, username: admin.username, shopName: admin.shopName } });
});

// Get Customers
app.get('/api/customers', auth, (req, res) => {
    res.json(readDB('customers.json'));
});

// Add Customer + Device (🔥 IMEI সহ একসাথে)
app.post('/api/customers', auth, (req, res) => {
    const customers = readDB('customers.json');
    const devices = readDB('devices.json');
    
    const customer = {
        id: generateId(),
        name: req.body.name,
        phone: req.body.phone,
        nid: req.body.nid || '',
        address: req.body.address || '',
        totalAmount: req.body.totalAmount,
        downPayment: req.body.downPayment,
        monthlyAmount: req.body.monthlyAmount,
        remainingAmount: req.body.totalAmount - req.body.downPayment,
        totalInstallments: req.body.totalInstallments || Math.ceil((req.body.totalAmount - req.body.downPayment) / req.body.monthlyAmount),
        paidInstallments: 0,
        status: 'active',
        adminId: req.admin.id,
        createdAt: new Date().toISOString()
    };
    customers.push(customer);
    writeDB('customers.json', customers);
    
    // 🔥 Device ও তৈরি (IMEI থাকলে)
    if (req.body.imei) {
        const nextDueDate = new Date();
        nextDueDate.setMonth(nextDueDate.getMonth() + 1);
        
        const device = {
            id: generateId(),
            customerId: customer.id,
            imei: req.body.imei,
            deviceModel: req.body.deviceModel || 'Android Device',
            phoneNumber: req.body.phone,
            monthlyAmount: req.body.monthlyAmount,
            nextDueDate: nextDueDate.toISOString(),
            locked: false,
            status: 'active',
            lockReason: '',
            createdAt: new Date().toISOString()
        };
        devices.push(device);
        writeDB('devices.json', devices);
    }
    
    res.status(201).json({ message: 'Customer registered', customer });
});

// Register Device
app.post('/api/devices/register', auth, (req, res) => {
    const devices = readDB('devices.json');
    const exists = devices.find(d => d.imei === req.body.imei);
    if (exists) return res.status(400).json({ message: 'Device already registered' });
    
    const nextDueDate = new Date();
    nextDueDate.setMonth(nextDueDate.getMonth() + 1);
    
    const device = {
        id: generateId(),
        ...req.body,
        nextDueDate: req.body.nextDueDate || nextDueDate.toISOString(),
        locked: false,
        status: 'active',
        lockReason: '',
        createdAt: new Date().toISOString()
    };
    devices.push(device);
    writeDB('devices.json', devices);
    
    res.status(201).json({ message: 'Device registered', device });
});

// Get Device Status (for agent app)
app.get('/api/devices/status/:imei', (req, res) => {
    const devices = readDB('devices.json');
    const device = devices.find(d => d.imei === req.params.imei);
    
    if (!device) return res.status(404).json({ message: 'Device not found' });
    
    res.json({
        locked: device.locked,
        status: device.status,
        lockReason: device.lockReason,
        nextDueDate: device.nextDueDate
    });
});

// Lock Device by IMEI
app.post('/api/lock/lock-by-imei/:imei', auth, (req, res) => {
    const devices = readDB('devices.json');
    const device = devices.find(d => d.imei === req.params.imei);
    if (!device) return res.status(404).json({ message: 'Device not found' });
    
    device.locked = true;
    device.status = 'locked';
    device.lockReason = req.body.reason || 'Manual lock by admin';
    device.lockDate = new Date().toISOString();
    writeDB('devices.json', devices);
    
    res.json({ message: 'Device locked successfully', device });
});

// Unlock Device by IMEI
app.post('/api/lock/unlock-by-imei/:imei', auth, (req, res) => {
    const devices = readDB('devices.json');
    const device = devices.find(d => d.imei === req.params.imei);
    if (!device) return res.status(404).json({ message: 'Device not found' });
    
    device.locked = false;
    device.status = 'active';
    device.lockReason = '';
    device.unlockDate = new Date().toISOString();
    
    // 🔥 পরবর্তী due date update (এক মাস পর)
    if (req.body.updateDueDate !== false) {
        const nextDue = new Date();
        nextDue.setMonth(nextDue.getMonth() + 1);
        device.nextDueDate = nextDue.toISOString();
    }
    
    writeDB('devices.json', devices);
    res.json({ message: 'Device unlocked successfully', device });
});

// Record Payment
app.post('/api/payments', auth, (req, res) => {
    const payments = readDB('payments.json');
    const customers = readDB('customers.json');
    const devices = readDB('devices.json');
    
    const payment = {
        id: generateId(),
        customerId: req.body.customerId,
        deviceId: req.body.deviceId,
        amount: req.body.amount,
        paymentMethod: req.body.paymentMethod,
        transactionId: req.body.transactionId || 'CASH',
        receiptNumber: 'RCP-' + Date.now().toString(36).toUpperCase(),
        receivedBy: req.admin.id,
        createdAt: new Date().toISOString()
    };
    payments.push(payment);
    writeDB('payments.json', payments);
    
    // 🔥 Payment করলে customer update + device unlock
    const customer = customers.find(c => c.id === req.body.customerId);
    if (customer) {
        customer.paidInstallments += 1;
        customer.remainingAmount -= req.body.amount;
        if (customer.paidInstallments >= customer.totalInstallments) {
            customer.status = 'completed';
        }
        writeDB('customers.json', customers);
    }
    
    // 🔥 Device unlock
    const device = devices.find(d => d.id === req.body.deviceId);
    if (device && device.locked) {
        device.locked = false;
        device.status = 'active';
        device.lockReason = '';
        device.unlockDate = new Date().toISOString();
        
        const nextDue = new Date();
        nextDue.setMonth(nextDue.getMonth() + 1);
        device.nextDueDate = nextDue.toISOString();
        
        writeDB('devices.json', devices);
    }
    
    res.status(201).json({ message: 'Payment recorded', payment, receiptNumber: payment.receiptNumber });
});

// Get Payment History
app.get('/api/payments/customer/:customerId', auth, (req, res) => {
    const payments = readDB('payments.json');
    res.json(payments.filter(p => p.customerId === req.params.customerId));
});

// Get All Devices
app.get('/api/devices', auth, (req, res) => {
    res.json(readDB('devices.json'));
});

// ==================== START SERVER ====================
if (!fs.existsSync(DB_PATH)) fs.mkdirSync(DB_PATH);
autoSetup();

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 Server running on http://localhost:${PORT}`);
    console.log(`🔑 Login: admin / admin123`);
    console.log(`⏰ Auto-lock check: Every 1 minute\n`);
});