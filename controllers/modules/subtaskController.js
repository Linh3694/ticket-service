const Ticket = require("../../models/Ticket");
const { SUBTASK_LOGS } = require('../../utils/logFormatter');

/**
 * Get subtasks by ticket ID
 */
const getSubTasksByTicket = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const userId = req.user._id;

    const ticket = await Ticket.findById(ticketId)
      .populate('subTasks.assignedTo', 'fullname email avatarUrl');

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket không tồn tại'
      });
    }

    // Check permission
    const isCreator = ticket.creator.equals(userId);
    const isAssignedTo = ticket.assignedTo && ticket.assignedTo.equals(userId);
    const isSupportTeam = req.user.roles && req.user.roles.some(role =>
      ['SIS IT', 'IT Helpdesk', 'System Manager', 'technical', 'superadmin'].includes(role)
    );

    if (!isCreator && !isAssignedTo && !isSupportTeam) {
      return res.status(403).json({
        success: false,
        message: 'Bạn không có quyền xem công việc của ticket này'
      });
    }

    const subTasks = ticket.subTasks || [];

    res.json({
      success: true,
      subTasks: subTasks
    });

  } catch (error) {
    console.error('❌ Error fetching subtasks:', error);
    res.status(500).json({
      success: false,
      message: 'Không thể tải danh sách công việc'
    });
  }
};

/**
 * Add subtask to ticket
 */
const addSubTask = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { title, description, assignedTo, status } = req.body;
    const userId = req.user._id;
    const userName = req.user.fullname || req.user.email;

    if (!title?.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Tiêu đề công việc không được để trống'
      });
    }

    const ticket = await Ticket.findById(ticketId);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket không tồn tại'
      });
    }

    // Check permission: only assignedTo or support team can add subtasks
    const isAssignedTo = ticket.assignedTo && ticket.assignedTo.equals(userId);
    const isSupportTeam = req.user.roles && req.user.roles.some(role =>
      ['SIS IT', 'IT Helpdesk', 'System Manager', 'technical', 'superadmin'].includes(role)
    );

    if (!isAssignedTo && !isSupportTeam) {
      return res.status(403).json({
        success: false,
        message: 'Bạn không có quyền thêm công việc cho ticket này'
      });
    }

    // Check if ticket status allows subtasks
    if (!['Processing', 'Waiting for Customer'].includes(ticket.status)) {
      return res.status(400).json({
        success: false,
        message: 'Không thể thêm công việc khi ticket ở trạng thái hiện tại'
      });
    }

    // Create subtask
    const subTask = {
      _id: require('mongoose').Types.ObjectId(),
      title: title.trim(),
      description: description?.trim() || '',
      assignedTo: assignedTo || null,
      status: status || 'In Progress',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Add to ticket
    if (!ticket.subTasks) {
      ticket.subTasks = [];
    }
    ticket.subTasks.push(subTask);

    // Log subtask creation
    ticket.history.push({
      timestamp: new Date(),
      action: SUBTASK_LOGS.CREATED(subTask.title, userName),
      user: userId
    });

    ticket.updatedAt = new Date();
    await ticket.save();

    // Populate for response
    await ticket.populate('subTasks.assignedTo', 'fullname email avatarUrl');

    res.status(201).json({
      success: true,
      ticket: ticket,
      message: 'Công việc đã được thêm thành công'
    });

  } catch (error) {
    console.error('❌ Error adding subtask:', error);
    res.status(500).json({
      success: false,
      message: 'Không thể thêm công việc',
      error: error.message
    });
  }
};

/**
 * Update subtask status
 */
const updateSubTaskStatus = async (req, res) => {
  try {
    const { ticketId, subTaskId } = req.params;
    const { status } = req.body;
    const userId = req.user._id;
    const userName = req.user.fullname || req.user.email;

    if (!status) {
      return res.status(400).json({
        success: false,
        message: 'Trạng thái không được để trống'
      });
    }

    const ticket = await Ticket.findById(ticketId);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket không tồn tại'
      });
    }

    // Find subtask
    const subTask = ticket.subTasks?.find(st => st._id.toString() === subTaskId);
    if (!subTask) {
      return res.status(404).json({
        success: false,
        message: 'Công việc không tồn tại'
      });
    }

    // Check permission
    const isAssignedTo = ticket.assignedTo && ticket.assignedTo.equals(userId);
    const isSupportTeam = req.user.roles && req.user.roles.some(role =>
      ['SIS IT', 'IT Helpdesk', 'System Manager', 'technical', 'superadmin'].includes(role)
    );
    const isSubTaskAssignee = subTask.assignedTo && subTask.assignedTo.equals(userId);

    if (!isAssignedTo && !isSupportTeam && !isSubTaskAssignee) {
      return res.status(403).json({
        success: false,
        message: 'Bạn không có quyền cập nhật công việc này'
      });
    }

    const oldStatus = subTask.status;
    subTask.status = status;
    subTask.updatedAt = new Date();

    // Log status change
    ticket.history.push({
      timestamp: new Date(),
      action: SUBTASK_LOGS.STATUS_CHANGED(subTask.title, oldStatus, status, userName),
      user: userId
    });

    ticket.updatedAt = new Date();
    await ticket.save();

    res.json({
      success: true,
      message: `Công việc "${subTask.title}" đã được cập nhật thành "${status}"`
    });

  } catch (error) {
    console.error('❌ Error updating subtask:', error);
    res.status(500).json({
      success: false,
      message: 'Không thể cập nhật công việc'
    });
  }
};

/**
 * Delete subtask
 */
const deleteSubTask = async (req, res) => {
  try {
    const { ticketId, subTaskId } = req.params;
    const userId = req.user._id;
    const userName = req.user.fullname || req.user.email;

    const ticket = await Ticket.findById(ticketId);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket không tồn tại'
      });
    }

    // Find subtask
    const subTaskIndex = ticket.subTasks?.findIndex(st => st._id.toString() === subTaskId);
    if (subTaskIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Công việc không tồn tại'
      });
    }

    const subTask = ticket.subTasks[subTaskIndex];

    // Check permission
    const isAssignedTo = ticket.assignedTo && ticket.assignedTo.equals(userId);
    const isSupportTeam = req.user.roles && req.user.roles.some(role =>
      ['SIS IT', 'IT Helpdesk', 'System Manager', 'technical', 'superadmin'].includes(role)
    );

    if (!isAssignedTo && !isSupportTeam) {
      return res.status(403).json({
        success: false,
        message: 'Bạn không có quyền xóa công việc này'
      });
    }

    // Log deletion
    ticket.history.push({
      timestamp: new Date(),
      action: SUBTASK_LOGS.DELETED(subTask.title, userName),
      user: userId
    });

    // Remove subtask
    ticket.subTasks.splice(subTaskIndex, 1);
    ticket.updatedAt = new Date();
    await ticket.save();

    res.json({
      success: true,
      message: `Công việc "${subTask.title}" đã được xóa thành công`
    });

  } catch (error) {
    console.error('❌ Error deleting subtask:', error);
    res.status(500).json({
      success: false,
      message: 'Không thể xóa công việc'
    });
  }
};

module.exports = {
  getSubTasksByTicket,
  addSubTask,
  updateSubTaskStatus,
  deleteSubTask
};
