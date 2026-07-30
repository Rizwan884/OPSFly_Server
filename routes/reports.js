const express = require('express');
const router = express.Router();
const User = require('../models/User');
const DailySummary = require('../models/DailySummary');
const Location = require('../models/Location');
const Note = require('../models/Note');
const Task = require('../models/Task');
const { getUserAccessibleLocationIds } = require('../middleware/scopeByLocation');

const mockAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Auth required' });
    const jwt = require('jsonwebtoken');
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'opsfly_premium_secure_jwt_secret_2026');
    req.user = await User.findById(decoded.userId || decoded.id);
    if (!req.user) return res.status(401).json({ error: 'User not found' });
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

router.use(mockAuth);

// GET /api/reports/export
router.get('/export', async (req, res) => {
  try {
    const { type, startDate, endDate, locationId } = req.query;

    const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate) : new Date();
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    // Location access validation
    let targetLocationIds = [];
    const accessibleIds = await getUserAccessibleLocationIds(req.user);

    if (locationId) {
      const parsedLocId = locationId.toString();
      if (!accessibleIds.map(id => id.toString()).includes(parsedLocId)) {
        return res.status(403).json({ error: 'Access denied to location' });
      }
      targetLocationIds = [locationId];
    } else {
      targetLocationIds = accessibleIds;
    }

    // Retrieve locations map
    const locations = await Location.find({ _id: { $in: targetLocationIds } });
    const locationsMap = {};
    locations.forEach(l => {
      locationsMap[l._id.toString()] = l.name;
    });

    let csvContent = '';

    if (type === 'monthly') {
      csvContent = 'Month,Location,Total Issues,Tasks Created,Tasks Completed,Completion Rate %\n';
      
      const summaries = await DailySummary.find({
        organizationId: req.user.organizationId,
        locationId: { $in: targetLocationIds },
        date: { $gte: start, $lte: end }
      });

      const monthlyData = {};
      summaries.forEach(s => {
        const monthKey = s.date.toISOString().substring(0, 7); // YYYY-MM
        const locId = s.locationId.toString();
        const key = `${monthKey}_${locId}`;
        
        if (!monthlyData[key]) {
          monthlyData[key] = {
            month: monthKey,
            location: locationsMap[locId] || 'Unknown',
            issues: 0,
            tasksCreated: 0,
            tasksCompleted: 0
          };
        }
        monthlyData[key].issues += s.totalIssues || 0;
        monthlyData[key].tasksCreated += s.totalTasks || 0;
        monthlyData[key].tasksCompleted += s.completedTasks || 0;
      });

      Object.values(monthlyData).forEach(m => {
        const rate = m.tasksCreated > 0 ? ((m.tasksCompleted / m.tasksCreated) * 100).toFixed(1) : '0.0';
        csvContent += `"${m.month}","${m.location}",${m.issues},${m.tasksCreated},${m.tasksCompleted},${rate}%\n`;
      });

    } else if (type === 'weekly') {
      csvContent = 'Week Starting,Location,Total Issues,Tasks Created,Tasks Completed,Completion Rate %\n';
      
      const summaries = await DailySummary.find({
        organizationId: req.user.organizationId,
        locationId: { $in: targetLocationIds },
        date: { $gte: start, $lte: end }
      });

      const getWeekKey = (d) => {
        const dateObj = new Date(d);
        const day = dateObj.getDay();
        const diff = dateObj.getDate() - day + (day === 0 ? -6 : 1); // Monday
        const mondayDate = new Date(dateObj.setDate(diff));
        return mondayDate.toISOString().split('T')[0];
      };

      const weeklyData = {};
      summaries.forEach(s => {
        const weekKey = getWeekKey(s.date);
        const locId = s.locationId.toString();
        const key = `${weekKey}_${locId}`;

        if (!weeklyData[key]) {
          weeklyData[key] = {
            week: weekKey,
            location: locationsMap[locId] || 'Unknown',
            issues: 0,
            tasksCreated: 0,
            tasksCompleted: 0
          };
        }
        weeklyData[key].issues += s.totalIssues || 0;
        weeklyData[key].tasksCreated += s.totalTasks || 0;
        weeklyData[key].tasksCompleted += s.completedTasks || 0;
      });

      Object.values(weeklyData).forEach(w => {
        const rate = w.tasksCreated > 0 ? ((w.tasksCompleted / w.tasksCreated) * 100).toFixed(1) : '0.0';
        csvContent += `"${w.week}","${w.location}",${w.issues},${w.tasksCreated},${w.tasksCompleted},${rate}%\n`;
      });

    } else {
      // Default to daily report
      csvContent = 'Date,Location,Total Issues,Staffing Issues,Cost Risks,Maintenance Issues,Other Issues,Tasks Created,Tasks Completed\n';

      const summaries = await DailySummary.find({
        organizationId: req.user.organizationId,
        locationId: { $in: targetLocationIds },
        date: { $gte: start, $lte: end }
      }).sort({ date: -1 });

      summaries.forEach(s => {
        const dateStr = s.date.toISOString().split('T')[0];
        const locName = locationsMap[s.locationId.toString()] || 'Unknown';
        csvContent += `"${dateStr}","${locName}",${s.totalIssues || 0},${s.staffingIssues || 0},${s.costRisks || 0},${s.maintenanceIssues || 0},${s.otherIssues || 0},${s.totalTasks || 0},${s.completedTasks || 0}\n`;
      });
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=opsfly_${type || 'daily'}_report.csv`);
    return res.status(200).send(csvContent);

  } catch (error) {
    return res.status(500).json({ error: 'Failed to export reports to CSV', detail: error.message });
  }
});

module.exports = router;
