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
 * Get feedback stats for team member - COMPREHENSIVE
 */
const getTeamMemberFeedbackStats = async (req, res) => {
  try {
    const { email } = req.params;

    // Find user by email with full data
    const user = await User.findOne({ email: email })
      .select('_id email fullname avatarUrl jobTitle department');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Người dùng không tồn tại'
      });
    }

    // Get ALL tickets assigned to this user
    const allTickets = await Ticket.find({
      assignedTo: user._id
    }).select('status feedback createdAt closedAt');

    const totalTickets = allTickets.length;
    const closedTickets = allTickets.filter(t => t.status === 'Closed').length;
    const completedTickets = allTickets.filter(t => ['Done', 'Closed'].includes(t.status)).length;

    // Get tickets with feedback
    const ticketsWithFeedback = allTickets.filter(t => t.feedback && t.feedback.rating);

    if (ticketsWithFeedback.length === 0) {
      return res.json({
        success: true,
        data: {
          user: {
            _id: user._id,
            email: user.email,
            fullname: user.fullname,
            avatarUrl: user.avatarUrl,
            jobTitle: user.jobTitle,
            department: user.department
          },
          summary: {
            totalTickets,
            completedTickets,
            closedTickets,
            feedbackCount: 0,
            completionRate: totalTickets > 0 ? Math.round((completedTickets / totalTickets) * 100) : 0,
            responseRate: 0
          },
          feedback: {
            averageRating: 0,
            ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
            badges: [],
            badgeCounts: {},
            totalBadges: 0
          }
        }
      });
    }

    // Calculate stats
    const ratings = ticketsWithFeedback.map(t => t.feedback.rating);
    const averageRating = ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length;

    // Rating distribution
    const ratingDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    ratings.forEach(rating => {
      ratingDistribution[rating] = (ratingDistribution[rating] || 0) + 1;
    });

    // Collect all badges
    const allBadges = ticketsWithFeedback.flatMap(t => t.feedback.badges || []);
    const badgeCounts = {};

    // Count badge occurrences
    allBadges.forEach(badge => {
      badgeCounts[badge] = (badgeCounts[badge] || 0) + 1;
    });

    // Get unique badges sorted by count
    const uniqueBadges = Object.keys(badgeCounts).sort((a, b) => badgeCounts[b] - badgeCounts[a]);

    const responseRate = totalTickets > 0 ? Math.round((ticketsWithFeedback.length / totalTickets) * 100) : 0;

    res.json({
      success: true,
      data: {
        user: {
          _id: user._id,
          email: user.email,
          fullname: user.fullname,
          avatarUrl: user.avatarUrl,
          jobTitle: user.jobTitle,
          department: user.department
        },
        summary: {
          totalTickets,
          completedTickets,
          closedTickets,
          feedbackCount: ticketsWithFeedback.length,
          completionRate: totalTickets > 0 ? Math.round((completedTickets / totalTickets) * 100) : 0,
          responseRate: responseRate
        },
        feedback: {
          averageRating: Math.round(averageRating * 10) / 10, // Round to 1 decimal
          ratingDistribution,
          badges: uniqueBadges,
          badgeCounts,
          totalBadges: allBadges.length
        }
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
 * Get technical stats (for admin) - COMPREHENSIVE
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
    }).select('_id email fullname avatarUrl jobTitle department');

    const userStats = await Promise.all(
      technicalUsers.map(async (user) => {
        // Get all tickets assigned to this user
        const allTickets = await Ticket.find({
          assignedTo: user._id
        }).select('status feedback');

        const totalTickets = allTickets.length;
        const closedTickets = allTickets.filter(t => t.status === 'Closed').length;
        const completedTickets = allTickets.filter(t => ['Done', 'Closed'].includes(t.status)).length;

        // Get tickets with feedback
        const ticketsWithFeedback = allTickets.filter(t => t.feedback && t.feedback.rating);

        let averageRating = 0;
        let ratingDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        let badgeCounts = {};
        let topBadges = [];

        if (ticketsWithFeedback.length > 0) {
          const ratings = ticketsWithFeedback.map(t => t.feedback.rating);
          averageRating = ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length;
          averageRating = Math.round(averageRating * 10) / 10;

          // Rating distribution
          ratings.forEach(rating => {
            ratingDistribution[rating] = (ratingDistribution[rating] || 0) + 1;
          });

          // Collect badges
          const allBadges = ticketsWithFeedback.flatMap(t => t.feedback.badges || []);
          allBadges.forEach(badge => {
            badgeCounts[badge] = (badgeCounts[badge] || 0) + 1;
          });

          // Get top 3 badges
          topBadges = Object.entries(badgeCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([badge, count]) => ({ badge, count }));
        }

        const responseRate = totalTickets > 0 ? Math.round((ticketsWithFeedback.length / totalTickets) * 100) : 0;
        const completionRate = totalTickets > 0 ? Math.round((completedTickets / totalTickets) * 100) : 0;

        return {
          user: {
            _id: user._id,
            email: user.email,
            fullname: user.fullname,
            avatarUrl: user.avatarUrl,
            jobTitle: user.jobTitle,
            department: user.department
          },
          summary: {
            totalTickets,
            completedTickets,
            closedTickets,
            feedbackCount: ticketsWithFeedback.length,
            completionRate,
            responseRate,
            averageRating
          },
          ratingBreakdown: {
            distribution: ratingDistribution,
            topBadges
          }
        };
      })
    );

    // Sort by completion rate, then response rate, then average rating
    userStats.sort((a, b) => {
      if (b.summary.completionRate !== a.summary.completionRate) {
        return b.summary.completionRate - a.summary.completionRate;
      }
      if (b.summary.responseRate !== a.summary.responseRate) {
        return b.summary.responseRate - a.summary.responseRate;
      }
      return b.summary.averageRating - a.summary.averageRating;
    });

    res.json({
      success: true,
      data: {
        timestamp: new Date(),
        totalMembers: userStats.length,
        members: userStats
      }
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
