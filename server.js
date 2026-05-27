const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'my-secret-key-2024';
const DB_PATH = path.join(__dirname, 'database');

// Ensure database directory exists
if (!fs.existsSync(DB_PATH)) {
    fs.mkdirSync(DB_PATH, { recursive: true });
}

// ==================== DATABASE ====================
function readDB(filename) {
    const filePath = path.join(DB_PATH, filename);
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, '[]');
        return [];
    }
    try {
        const data = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(data);
    } catch (e) {
        fs.writeFileSync(filePath, '[]');
        return [];
    }
}

function writeDB(filename, data) {
    const filePath = path.join(DB_PATH, filename);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

// ==================== AUTO SETUP ====================
function autoSetup() {
    try {
        let admins = readDB('admins.json');
        if (admins.length === 0) {
            admins.push({
                id: generateId(),
                username: 'admin',
                password: bcrypt.hashSync('admin123', 10),
                shopName: 'My Shop',
                createdAt: new Date().toISOString()
            });
            writeDB('admins.json', admins);
            console.log('Admin created: admin / admin123');
        }
    } catch (e) {
        console.error('Setup error:', e.message);
    }
}

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

// Health check
app.get('/api/setup', (req, res) => {
    res.json({ setupRequired: false, adminCount: readDB('admins.json').length, message: 'System ready' });
});

// Login
app.post('/api/auth/login', (req, res) => {
    try {
        const { username, password } = req.body;
        const admins = readDB('admins.json');
        const admin = admins.find(a => a.username === username);
        
        if (!admin) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }
        
        const isMatch = bcrypt.compareSync(password, admin.password);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }
        
        const token = jwt.sign({ id: admin.id, username: admin.username }, JWT_SECRET, { expiresIn: '365d' });
        res.json({ success: true, token, admin: { id: admin.id, username: admin.username, shopName: admin.shopName } });
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
});

// Get Customers
app.get('/api/customers', auth, (req, res) => {
    res.json(readDB('customers.json'));
});

// Add Customer
app.post('/api/customers', auth, (req, res) => {
    try {
        const customers = readDB('customers.json');
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
            totalInstallments: Math.ceil((req.body.totalAmount - req.body.downPayment) / req.body.monthlyAmount),
            paidInstallments: 0,
            status: 'active',
            adminId: req.admin.id,
            createdAt: new Date().toISOString()
        };
        customers.push(customer);
        writeDB('customers.json', customers);
        
        // Register device if IMEI provided
        if (req.body.imei) {
            const devices = readDB('devices.json');
            const nextDue = new Date();
            nextDue.setMonth(nextDue.getMonth() + 1);
            devices.push({
                id: generateId(),
                customerId: customer.id,
                imei: req.body.imei,
                deviceModel: req.body.deviceModel || 'Android Device',
                phoneNumber: req.body.phone,
                monthlyAmount: req.body.monthlyAmount,
                nextDueDate: nextDue.toISOString(),
                locked: false,
                status: 'active',
                lockReason: '',
                createdAt: new Date().toISOString()
            });
            writeDB('devices.json', devices);
        }
        
        res.status(201).json({ message: 'Customer registered', customer });
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
});

// Get Device Status
app.get('/api/devices/status/:imei', (req, res) => {
    const devices = readDB('devices.json');
    const device = devices.find(d => d.imei === req.params.imei);
    if (!device) return res.status(404).json({ message: 'Device not found' });
    res.json({ locked: device.locked, status: device.status, lockReason: device.lockReason || '' });
});

// Register Device
app.post('/api/devices/register', auth, (req, res) => {
    try {
        const devices = readDB('devices.json');
        const exists = devices.find(d => d.imei === req.body.imei);
        if (exists) return res.status(400).json({ message: 'Device already registered' });
        
        const nextDue = new Date();
        nextDue.setMonth(nextDue.getMonth() + 1);
        
        const device = {
            id: generateId(),
            ...req.body,
            nextDueDate: req.body.nextDueDate || nextDue.toISOString(),
            locked: false,
            status: 'active',
            lockReason: '',
            createdAt: new Date().toISOString()
        };
        devices.push(device);
        writeDB('devices.json', devices);
        res.status(201).json({ message: 'Device registered', device });
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
});

// Lock Device
app.post('/api/lock/lock-by-imei/:imei', auth, (req, res) => {
    try {
        const devices = readDB('devices.json');
        const device = devices.find(d => d.imei === req.params.imei);
        if (!device) return res.status(404).json({ message: 'Device not found' });
        
        device.locked = true;
        device.status = 'locked';
        device.lockReason = req.body.reason || 'Manual lock';
        device.lockDate = new Date().toISOString();
        writeDB('devices.json', devices);
        res.json({ message: 'Device locked', device });
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
});

// Unlock Device
app.post('/api/lock/unlock-by-imei/:imei', auth, (req, res) => {
    try {
        const devices = readDB('devices.json');
        const device = devices.find(d => d.imei === req.params.imei);
        if (!device) return res.status(404).json({ message: 'Device not found' });
        
        device.locked = false;
        device.status = 'active';
        device.lockReason = '';
        device.unlockDate = new Date().toISOString();
        writeDB('devices.json', devices);
        res.json({ message: 'Device unlocked', device });
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
});

// Record Payment
app.post('/api/payments', auth, (req, res) => {
    try {
        const payments = readDB('payments.json');
        const devices = readDB('devices.json');
        
        const payment = {
            id: generateId(),
            ...req.body,
            receiptNumber: 'RCP-' + Date.now().toString(36).toUpperCase(),
            receivedBy: req.admin.id,
            createdAt: new Date().toISOString()
        };
        payments.push(payment);
        writeDB('payments.json', payments);
        
        // Unlock device if payment made
        if (req.body.deviceId) {
            const device = devices.find(d => d.id === req.body.deviceId);
            if (device) {
                device.locked = false;
                device.status = 'active';
                device.lockReason = '';
                device.unlockDate = new Date().toISOString();
                const nextDue = new Date();
                nextDue.setMonth(nextDue.getMonth() + 1);
                device.nextDueDate = nextDue.toISOString();
                writeDB('devices.json', devices);
            }
        }
        
        res.status(201).json({ message: 'Payment recorded', payment, receiptNumber: payment.receiptNumber });
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
});

// ==================== START ====================
autoSetup();

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
    console.log('Login: admin / admin123');
});