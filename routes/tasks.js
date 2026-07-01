const express = require('express');
const router = express.Router();
const Task = require('../models/Task');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { sendPushNotification } = require('../services/pushNotifications');

// Mock auth middleware for Express routes
const mockAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Auth required' });
    const jwt = require('jsonwebtoken');
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'opsfly_premium_secure_jwt_secret_2026');
    req.user = await User.findById(decoded.userId || decoded.id);
    if (!req.user || req.user.isActive === false || req.user.deleted === true) {
      return res.status(401).json({ error: 'User not found or deactivated' });
    }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

router.use(mockAuth);

// GET /api/tasks — fetch all tasks
router.get('/', async (req, res) => {
  try {
    const selectedLocationId = req.headers['x-location-id'];
    if (!selectedLocationId) {
      return res.status(400).json({ error: 'x-location-id header is required' });
    }

    let query = {
      locationId: selectedLocationId
    };

    if (req.user.role === 'department_manager') {
      const deptUsers = await User.find({
        locationIds: selectedLocationId,
        department: req.user.department
      }).select('_id');
      const deptUserIds = deptUsers.map(u => u._id);
      query.$or = [
        { userId: { $in: deptUserIds } },
        { assignedTo: { $in: deptUserIds } }
      ];
    }

    const tasks = await Task.find(query)
      .populate('sourceNoteId', 'transcript createdAt')
      .populate('assignedTo', 'name email role department')
      .populate('assignedBy', 'name email role department')
      .lean();

    const order = { High: 0, Medium: 1, Low: 2 };
    tasks.sort((a, b) =>
      (order[a.priority] ?? 3) - (order[b.priority] ?? 3) ||
      new Date(b.createdAt) - new Date(a.createdAt)
    );
    return res.json(tasks);
  } catch (err) {
    console.error('[GET /api/tasks]', err);
    return res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

// POST /api/tasks — create a new task
router.post('/', async (req, res) => {
  try {
    const selectedLocationId = req.headers['x-location-id'];
    if (!selectedLocationId) {
      return res.status(400).json({ error: 'x-location-id header is required' });
    }

    const { title, priority = 'Medium', sourceNoteId, sourceIssueType, assignedTo } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'title is required' });

    const dueDate = new Date();
    dueDate.setHours(23, 59, 0, 0);

    // Validate assignment if assignedTo is provided
    let finalAssignedTo = null;
    let finalAssignedBy = null;
    if (assignedTo) {
      // Only allow owner, dm, gm, agm to assign
      if (!['owner', 'district_manager', 'gm', 'agm', 'Manager'].includes(req.user.role)) {
        return res.status(403).json({ error: 'Forbidden. You do not have permission to assign tasks.' });
      }
      const assignedUser = await User.findById(assignedTo);
      if (!assignedUser) {
        return res.status(404).json({ error: 'Assigned user not found.' });
      }

      // Enforce role hierarchy check
      const assignerRole = req.user.role;
      const assigneeRole = assignedUser.role;
      let allowed = false;
      if (assignerRole === 'owner') allowed = true;
      else if (assignerRole === 'district_manager' && (assigneeRole === 'gm' || assigneeRole === 'district_manager')) allowed = true;
      else if ((assignerRole === 'gm' || assignerRole === 'Manager') && ['agm', 'department_manager', 'Staff'].includes(assigneeRole)) allowed = true;
      else if (assignerRole === 'agm' && ['department_manager', 'Staff'].includes(assigneeRole)) allowed = true;

      if (!allowed && assignedUser._id.toString() !== req.user._id.toString()) {
        return res.status(403).json({ error: `Forbidden. As a ${assignerRole.replace('_', ' ')}, you cannot assign tasks to a ${assigneeRole.replace('_', ' ')}.` });
      }

      // Owner can assign across locations (same org), others must assign at same location
      if (req.user.role === 'owner') {
        if (assignedUser.organizationId?.toString() !== req.user.organizationId?.toString()) {
          return res.status(400).json({ error: 'Assigned user must belong to your organization.' });
        }
      } else {
        const targetLocs = assignedUser.locationIds.map(locId => locId.toString());
        if (!targetLocs.includes(selectedLocationId.toString())) {
          return res.status(400).json({ error: 'Assigned user must be assigned to the current location.' });
        }
      }

      finalAssignedTo = assignedTo;
      finalAssignedBy = req.user._id;
    }

    const task = await Task.create({
      title: title.trim(),
      priority,
      sourceNoteId: sourceNoteId || null,
      sourceIssueType: sourceIssueType || null,
      dueDate,
      userId: req.user._id,
      locationId: selectedLocationId,
      organizationId: req.user.organizationId,
      assignedTo: finalAssignedTo,
      assignedBy: finalAssignedBy,
    });

    // Trigger notification: task_assigned
    if (task.assignedTo) {
      try {
        await Notification.create({
          userId: task.assignedTo,
          type: 'task_assigned',
          message: `New task assigned: ${task.title}`,
          relatedTaskId: task._id
        });

        await sendPushNotification(
          task.assignedTo,
          'New Task Assigned',
          `New task assigned: ${task.title}`,
          { relatedTaskId: task._id, type: 'task_assigned' }
        );
      } catch (nErr) {
        console.error('Failed to create assignment notification', nErr);
      }
    }

    const populatedTask = await Task.findById(task._id)
      .populate('assignedTo', 'name email role department')
      .populate('assignedBy', 'name email role department');

    return res.status(201).json(populatedTask);
  } catch (err) {
    console.error('[POST /api/tasks]', err);
    return res.status(500).json({ error: 'Failed to create task', detail: err.message });
  }
});

// PATCH /api/tasks/:id — complete, reopen, or assign
router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const selectedLocationId = req.headers['x-location-id'];
  if (!selectedLocationId) {
    return res.status(400).json({ error: 'x-location-id header is required' });
  }

  try {
    const task = await Task.findById(id);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    // Enforce location access
    if (task.locationId && task.locationId.toString() !== selectedLocationId.toString()) {
      return res.status(403).json({ error: 'Forbidden. Task is in a different location.' });
    }

    // Restrict access for department managers
    if (req.user.role === 'department_manager') {
      const isOwner = task.userId?.toString() === req.user._id.toString();
      const isAssigned = task.assignedTo?.toString() === req.user._id.toString();
      if (!isOwner && !isAssigned) {
        return res.status(403).json({ error: 'Forbidden. You do not have permission to manage this task.' });
      }
    }

    const { action, assignedTo } = req.body || {};

    if (action === 'complete') {
      task.status = 'completed';
      task.completedAt = new Date();
      await task.save();

      // Trigger notification: task_completed
      try {
        const recipients = new Set();
        if (task.assignedBy) recipients.add(task.assignedBy.toString());
        if (task.userId) recipients.add(task.userId.toString());
        
        const managers = await User.find({
          locationIds: selectedLocationId,
          role: { $in: ['owner', 'gm', 'Manager'] },
          isActive: { $ne: false },
          deleted: { $ne: true }
        }).select('_id');
        managers.forEach(m => recipients.add(m._id.toString()));
        
        recipients.delete(req.user._id.toString());
        
        if (recipients.size > 0) {
          const notifications = Array.from(recipients).map(uid => ({
            userId: uid,
            type: 'task_completed',
            message: `${req.user.name} completed: ${task.title}`,
            relatedTaskId: task._id
          }));
          await Notification.insertMany(notifications);

          for (const uid of Array.from(recipients)) {
            await sendPushNotification(
              uid,
              'Task Completed',
              `${req.user.name} completed: ${task.title}`,
              { relatedTaskId: task._id, type: 'task_completed' }
            );
          }
        }
      } catch (nErr) {
        console.error('Failed to create task completion notification', nErr);
      }

      const updated = await Task.findById(task._id)
        .populate('assignedTo', 'name email role department')
        .populate('assignedBy', 'name email role department');
      return res.json(updated);
    }

    if (action === 'reopen') {
      task.status = 'open';
      task.completedAt = null;
      await task.save();
      const updated = await Task.findById(task._id)
        .populate('assignedTo', 'name email role department')
        .populate('assignedBy', 'name email role department');
      return res.json(updated);
    }

    if (action === 'assign') {
      if (!['owner', 'district_manager', 'gm', 'agm', 'Manager'].includes(req.user.role)) {
        return res.status(403).json({ error: 'Forbidden. You do not have permission to assign tasks.' });
      }
      if (!assignedTo) {
        task.assignedTo = null;
        task.assignedBy = null;
      } else {
        const targetUser = await User.findById(assignedTo);
        if (!targetUser) {
          return res.status(404).json({ error: 'Assigned user not found.' });
        }

        // Enforce role hierarchy check
        const assignerRole = req.user.role;
        const assigneeRole = targetUser.role;
        let allowed = false;
        if (assignerRole === 'owner') allowed = true;
        else if (assignerRole === 'district_manager' && (assigneeRole === 'gm' || assigneeRole === 'district_manager')) allowed = true;
        else if ((assignerRole === 'gm' || assignerRole === 'Manager') && ['agm', 'department_manager', 'Staff'].includes(assigneeRole)) allowed = true;
        else if (assignerRole === 'agm' && ['department_manager', 'Staff'].includes(assigneeRole)) allowed = true;

        if (!allowed && targetUser._id.toString() !== req.user._id.toString()) {
          return res.status(403).json({ error: `Forbidden. As a ${assignerRole.replace('_', ' ')}, you cannot assign tasks to a ${assigneeRole.replace('_', ' ')}.` });
        }

        // Owner can assign across locations (same org), others must assign at same location
        if (req.user.role === 'owner') {
          if (targetUser.organizationId?.toString() !== req.user.organizationId?.toString()) {
            return res.status(400).json({ error: 'Assigned user must belong to your organization.' });
          }
        } else {
          const targetLocs = targetUser.locationIds.map(locId => locId.toString());
          if (!targetLocs.includes(selectedLocationId.toString())) {
            return res.status(400).json({ error: 'Assigned user must be assigned to the current location.' });
          }
        }

        task.assignedTo = targetUser._id;
        task.assignedBy = req.user._id;
      }
      await task.save();

      if (assignedTo && task.assignedTo) {
        try {
          await Notification.create({
            userId: task.assignedTo,
            type: 'task_assigned',
            message: `New task assigned: ${task.title}`,
            relatedTaskId: task._id
          });

          await sendPushNotification(
            task.assignedTo,
            'New Task Assigned',
            `New task assigned: ${task.title}`,
            { relatedTaskId: task._id, type: 'task_assigned' }
          );
        } catch (nErr) {
          console.error('Failed to create assignment notification', nErr);
        }
      }

      const updated = await Task.findById(task._id)
        .populate('assignedTo', 'name email role department')
        .populate('assignedBy', 'name email role department');
      return res.json(updated);
    }

    return res.status(400).json({ error: 'Invalid action.' });
  } catch (err) {
    console.error('[PATCH /api/tasks/:id]', err);
    return res.status(500).json({ error: 'Failed to process task operation' });
  }
});

// DELETE /api/tasks/:id
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const task = await Task.findById(id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    await task.deleteOne();
    return res.json({ success: true });
  } catch (err) {
    console.error('[DELETE /api/tasks/:id]', err);
    return res.status(500).json({ error: 'Failed to delete task' });
  }
});

module.exports = router;
