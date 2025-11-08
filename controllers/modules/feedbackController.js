const Ticket = require("../../models/Ticket");
const User = require("../../models/Users");
const { TICKET_LOGS } = require('../../utils/logFormatter');
const notificationService = require('../../services/notificationService');

/**
 * Accept feedback and close ticket
 */
const acceptFeedback = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { rating, comment, badges } = req.body;
    const userId = req.user._id;
    const userName = req.user.fullname || req.user.email;

    // Validation
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({
        success: false,
        message: 'Đánh giá phải từ 1 đến 5 sao'
      });
    }

    const ticket = await Ticket.findById(ticketId);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket không tồn tại'
      });
    }

    // Check permission: only creator can give feedback
    if (!ticket.creator.equals(userId)) {
      return res.status(403).json({
        success: false,
        message: 'Chỉ người tạo ticket mới có thể đánh giá'
      });
    }

    // Check if ticket can be closed
    if (!['Processing', 'Waiting for Customer'].includes(ticket.status)) {
      return res.status(400).json({
        success: false,
        message: 'Ticket không thể được đóng ở trạng thái hiện tại'
      });
    }

    // Create feedback object
    const feedback = {
      assignedTo: ticket.assignedTo,
      rating: rating,
      comment: comment?.trim() || '',
      badges: badges || [],
      createdAt: new Date()
    };

    // Update ticket
    ticket.feedback = feedback;
    ticket.status = 'Closed';
    ticket.closedAt = new Date();

    // Log feedback acceptance
    ticket.history.push({
      timestamp: new Date(),
      action: TICKET_LOGS.FEEDBACK_ACCEPTED(userName, rating),
      user: userId
    });

    await ticket.save();

    // Send notification to assigned user
    try {
      if (ticket.assignedTo) {
        await notificationService.sendFeedbackReceived(ticket, feedback);
      }
    } catch (notificationError) {
      console.error('❌ Notification error:', notificationError);
      // Don't fail the request if notification fails
    }

    res.json({
      success: true,
      message: 'Cảm ơn bạn đã đánh giá! Ticket đã được đóng thành công.',
      ticket: {
        _id: ticket._id,
        status: ticket.status,
        feedback: ticket.feedback,
        closedAt: ticket.closedAt
      }
    });

  } catch (error) {
    console.error('❌ Error accepting feedback:', error);
    res.status(500).json({
      success: false,
      message: 'Không thể gửi đánh giá',
      error: error.message
    });
  }
};

/**
 * Get feedback stats for team member
 */
const getTeamMemberFeedbackStats = async (req, res) => {
  try {
    const { email } = req.params;

    // Find user by email
    const user = await User.findOne({ email: email });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Người dùng không tồn tại'
      });
    }

    // Get all tickets assigned to this user with feedback
    const ticketsWithFeedback = await Ticket.find({
      assignedTo: user._id,
      feedback: { $exists: true, $ne: null }
    }).select('feedback');

    if (ticketsWithFeedback.length === 0) {
      return res.json({
        success: true,
        data: {
          averageRating: 0,
          totalFeedbacks: 0,
          badges: [],
          badgeCounts: {}
        }
      });
    }

    // Calculate stats
    const ratings = ticketsWithFeedback.map(t => t.feedback.rating);
    const averageRating = ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length;

    // Collect all badges
    const allBadges = ticketsWithFeedback.flatMap(t => t.feedback.badges || []);
    const badgeCounts = {};

    // Count badge occurrences
    allBadges.forEach(badge => {
      badgeCounts[badge] = (badgeCounts[badge] || 0) + 1;
    });

    // Get unique badges sorted by count
    const uniqueBadges = Object.keys(badgeCounts).sort((a, b) => badgeCounts[b] - badgeCounts[a]);

    res.json({
      success: true,
      data: {
        averageRating: Math.round(averageRating * 10) / 10, // Round to 1 decimal
        totalFeedbacks: ticketsWithFeedback.length,
        badges: uniqueBadges,
        badgeCounts: badgeCounts
      }
    });

  } catch (error) {
    console.error('❌ Error fetching feedback stats:', error);
    res.status(500).json({
      success: false,
      message: 'Không thể tải thống kê đánh giá'
    });
  }
};

/**
 * Get technical stats (for admin)
 */
const getTechnicalStats = async (req, res) => {
  try {
    // Get all technical users
    const technicalUsers = await User.find({
      active: true,
      disabled: { $ne: true },
      $or: [
        { role: { $in: ['technical', 'superadmin'] } },
        { roles: { $in: ['SIS IT', 'IT Helpdesk', 'System Manager'] } }
      ]
    }).select('_id email fullname');

    const userStats = await Promise.all(
      technicalUsers.map(async (user) => {
        // Count tickets assigned to this user
        const totalTickets = await Ticket.countDocuments({ assignedTo: user._id });

        // Count completed tickets with feedback
        const completedTickets = await Ticket.countDocuments({
          assignedTo: user._id,
          status: { $in: ['Done', 'Closed'] },
          feedback: { $exists: true, $ne: null }
        });

        // Calculate average rating
        const ticketsWithFeedback = await Ticket.find({
          assignedTo: user._id,
          feedback: { $exists: true, $ne: null }
        }).select('feedback.rating');

        let averageRating = 0;
        if (ticketsWithFeedback.length > 0) {
          const ratings = ticketsWithFeedback.map(t => t.feedback.rating);
          averageRating = ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length;
          averageRating = Math.round(averageRating * 10) / 10;
        }

        return {
          user: {
            _id: user._id,
            email: user.email,
            fullname: user.fullname
          },
          stats: {
            totalTickets,
            completedTickets,
            averageRating,
            completionRate: totalTickets > 0 ? Math.round((completedTickets / totalTickets) * 100) : 0
          }
        };
      })
    );

    // Sort by completion rate and average rating
    userStats.sort((a, b) => {
      if (b.stats.completionRate !== a.stats.completionRate) {
        return b.stats.completionRate - a.stats.completionRate;
      }
      return b.stats.averageRating - a.stats.averageRating;
    });

    res.json({
      success: true,
      data: userStats
    });

  } catch (error) {
    console.error('❌ Error fetching technical stats:', error);
    res.status(500).json({
      success: false,
      message: 'Không thể tải thống kê kỹ thuật viên'
    });
  }
};

/**
 * Add feedback (legacy function)
 */
const addFeedback = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { rating, comment } = req.body;
    const userId = req.user._id;

    const ticket = await Ticket.findById(ticketId);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket không tồn tại'
      });
    }

    // Check permission
    if (!ticket.creator.equals(userId)) {
      return res.status(403).json({
        success: false,
        message: 'Chỉ người tạo ticket mới có thể đánh giá'
      });
    }

    ticket.feedback = {
      rating: rating,
      comment: comment,
      createdAt: new Date()
    };

    ticket.status = 'Done';
    ticket.closedAt = new Date();

    await ticket.save();

    res.json({
      success: true,
      message: 'Feedback đã được gửi thành công'
    });

  } catch (error) {
    console.error('❌ Error adding feedback:', error);
    res.status(500).json({
      success: false,
      message: 'Không thể gửi feedback'
    });
  }
};

module.exports = {
  acceptFeedback,
  getTeamMemberFeedbackStats,
  getTechnicalStats,
  addFeedback
};
