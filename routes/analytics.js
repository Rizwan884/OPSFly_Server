const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Note = require('../models/Note');
const Task = require('../models/Task');
const Location = require('../models/Location');
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

// Helper to format Date to YYYY-MM-DD in local time
const formatDateStr = (date) => {
  return date.toISOString().split('T')[0];
};

// GET /api/analytics/summary
router.get('/summary', async (req, res) => {
  try {
    const { locationId, startDate, endDate } = req.query;
    
    const start = startDate ? new Date(startDate) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate) : new Date();
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    // Scoping check
    let targetLocationIds = [];
    const accessibleIds = await getUserAccessibleLocationIds(req.user);

    if (locationId) {
      const parsedLocId = locationId.toString();
      if (!accessibleIds.map(id => id.toString()).includes(parsedLocId)) {
        return res.status(403).json({ error: 'Access denied to requested location' });
      }
      targetLocationIds = [locationId];
    } else {
      targetLocationIds = accessibleIds;
    }

    // Query Notes for issues
    const notesQuery = {
      organizationId: req.user.organizationId,
      locationId: { $in: targetLocationIds },
      createdAt: { $gte: start, $lte: end }
    };
    const notes = await Note.find(notesQuery);

    // Query Tasks
    const tasksQuery = {
      organizationId: req.user.organizationId,
      locationId: { $in: targetLocationIds },
      createdAt: { $gte: start, $lte: end }
    };
    const tasks = await Task.find(tasksQuery);

    // Query all open tasks (no date range limit for general "Open Tasks" count card)
    const openTasksCount = await Task.countDocuments({
      organizationId: req.user.organizationId,
      locationId: { $in: targetLocationIds },
      status: 'open'
    });

    // 1. Issues aggregations
    let totalIssues = 0;
    const issueTypeCounts = { Staffing: 0, 'Cost Risk': 0, Maintenance: 0, Other: 0 };
    const issueSeverityCounts = { High: 0, Medium: 0, Low: 0 };
    const recurringIssuesMap = {};

    notes.forEach(note => {
      if (note.issues && note.issues.length > 0) {
        note.issues.forEach(issue => {
          totalIssues++;
          const type = issue.type || 'Other';
          const severity = issue.severity || 'Medium';
          
          if (issueTypeCounts[type] !== undefined) {
            issueTypeCounts[type]++;
          } else {
            issueTypeCounts['Other']++;
          }
          
          if (issueSeverityCounts[severity] !== undefined) {
            issueSeverityCounts[severity]++;
          }

          if (issue.quote) {
            recurringIssuesMap[issue.quote] = (recurringIssuesMap[issue.quote] || 0) + 1;
          }
        });
      }
    });

    const topRecurringIssues = Object.entries(recurringIssuesMap)
      .map(([title, count]) => ({ title, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // 2. Tasks aggregations
    const totalTasksCreated = tasks.length;
    const completedTasksInRange = tasks.filter(t => t.status === 'completed');
    const totalTasksCompleted = completedTasksInRange.length;
    
    // Average completion time
    let totalCompletionTimeMs = 0;
    let completedCount = 0;
    const priorityCompletionTimes = { High: { total: 0, count: 0 }, Medium: { total: 0, count: 0 }, Low: { total: 0, count: 0 } };

    completedTasksInRange.forEach(t => {
      if (t.completedAt) {
        const timeDiff = new Date(t.completedAt).getTime() - new Date(t.createdAt).getTime();
        totalCompletionTimeMs += timeDiff;
        completedCount++;

        const prio = t.priority || 'Medium';
        if (priorityCompletionTimes[prio]) {
          priorityCompletionTimes[prio].total += timeDiff;
          priorityCompletionTimes[prio].count++;
        }
      }
    });

    const averageCompletionTimeHours = completedCount > 0 ? (totalCompletionTimeMs / completedCount) / (1000 * 60 * 60) : 0;
    const avgTimeByPriority = {
      High: priorityCompletionTimes.High.count > 0 ? (priorityCompletionTimes.High.total / priorityCompletionTimes.High.count) / (1000 * 60 * 60) : 0,
      Medium: priorityCompletionTimes.Medium.count > 0 ? (priorityCompletionTimes.Medium.total / priorityCompletionTimes.Medium.count) / (1000 * 60 * 60) : 0,
      Low: priorityCompletionTimes.Low.count > 0 ? (priorityCompletionTimes.Low.total / priorityCompletionTimes.Low.count) / (1000 * 60 * 60) : 0,
    };

    // Tasks by assignee
    const assigneeMap = {};
    for (const t of tasks) {
      if (t.assignedTo) {
        const assigneeId = t.assignedTo.toString();
        if (!assigneeMap[assigneeId]) {
          const user = await User.findById(t.assignedTo);
          assigneeMap[assigneeId] = { name: user ? user.name : 'Unknown Assignee', created: 0, completed: 0 };
        }
        assigneeMap[assigneeId].created++;
        if (t.status === 'completed') {
          assigneeMap[assigneeId].completed++;
        }
      }
    }
    const tasksByAssignee = Object.values(assigneeMap);

    // Overdue tasks (status is open and dueDate is past end date)
    const overdueTasksCount = tasks.filter(t => t.status === 'open' && t.dueDate && new Date(t.dueDate) < new Date()).length;

    // 3. Daily Breakdown
    const dailyBreakdown = [];
    const currentDate = new Date(start);
    while (currentDate <= end) {
      const dateStr = formatDateStr(currentDate);
      dailyBreakdown.push({
        date: dateStr,
        issues: 0,
        tasksCreated: 0,
        tasksCompleted: 0
      });
      currentDate.setDate(currentDate.getDate() + 1);
    }

    notes.forEach(note => {
      const noteDateStr = formatDateStr(new Date(note.createdAt));
      const entry = dailyBreakdown.find(d => d.date === noteDateStr);
      if (entry) {
        entry.issues += note.issues ? note.issues.length : 0;
      }
    });

    tasks.forEach(task => {
      const createdDateStr = formatDateStr(new Date(task.createdAt));
      const entryCreated = dailyBreakdown.find(d => d.date === createdDateStr);
      if (entryCreated) {
        entryCreated.tasksCreated++;
      }

      if (task.status === 'completed' && task.completedAt) {
        const completedDateStr = formatDateStr(new Date(task.completedAt));
        const entryCompleted = dailyBreakdown.find(d => d.date === completedDateStr);
        if (entryCompleted) {
          entryCompleted.tasksCompleted++;
        }
      }
    });

    return res.json({
      summary: {
        totalIssues,
        openIssuesCount: totalIssues, // active issues in period
        totalLocations: targetLocationIds.length,
        openTasksCount,
        totalTasksCreated,
        totalTasksCompleted,
        overdueTasksCount,
        averageCompletionTimeHours,
        avgTimeByPriority
      },
      charts: {
        issueTypeCounts,
        issueSeverityCounts,
        topRecurringIssues,
        tasksByAssignee,
        dailyBreakdown
      }
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to generate analytics summary', detail: error.message });
  }
});

// GET /api/analytics/locations
router.get('/locations', async (req, res) => {
  try {
    if (!['owner', 'district_manager'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden. Owner or District Manager only.' });
    }

    const accessibleIds = await getUserAccessibleLocationIds(req.user);
    const locations = await Location.find({ _id: { $in: accessibleIds } });

    const report = [];
    for (const loc of locations) {
      // Open issues count
      const notes = await Note.find({ locationId: loc._id });
      let openIssues = 0;
      notes.forEach(n => {
        openIssues += n.issues ? n.issues.length : 0;
      });

      // Open tasks
      const openTasks = await Task.countDocuments({ locationId: loc._id, status: 'open' });
      // Completed tasks
      const completedTasks = await Task.countDocuments({ locationId: loc._id, status: 'completed' });
      // Total team members
      const teamMembers = await User.countDocuments({ locationIds: loc._id, deleted: { $ne: true } });

      // Last activity
      const lastNote = await Note.findOne({ locationId: loc._id }).sort({ createdAt: -1 });
      const lastTask = await Task.findOne({ locationId: loc._id }).sort({ updatedAt: -1 });
      
      let lastActivity = 'None';
      if (lastNote && lastTask) {
        lastActivity = lastNote.createdAt > lastTask.updatedAt ? lastNote.createdAt : lastTask.updatedAt;
      } else if (lastNote) {
        lastActivity = lastNote.createdAt;
      } else if (lastTask) {
        lastActivity = lastTask.updatedAt;
      }

      report.push({
        locationId: loc._id,
        name: loc.name,
        address: loc.address || 'No Address',
        teamMembers,
        openIssues,
        openTasks,
        completedTasks,
        lastActivity
      });
    }

    return res.json(report);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch per-location analytics', detail: error.message });
  }
});

// GET /api/analytics/team
router.get('/team', async (req, res) => {
  try {
    const accessibleIds = await getUserAccessibleLocationIds(req.user);
    const users = await User.find({
      organizationId: req.user.organizationId,
      locationIds: { $in: accessibleIds },
      deleted: { $ne: true }
    });

    const report = [];
    for (const u of users) {
      const notesCount = await Note.countDocuments({ userId: u._id });
      const tasksCompletedCount = await Task.countDocuments({ assignedTo: u._id, status: 'completed' });

      report.push({
        userId: u._id,
        name: u.name,
        email: u.email,
        role: u.role,
        department: u.department || 'N/A',
        notesRecorded: notesCount,
        tasksCompleted: tasksCompletedCount
      });
    }

    return res.json(report);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch team analytics', detail: error.message });
  }
});

module.exports = router;
