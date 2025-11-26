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
    const ratingNum = parseInt(rating, 10);
    if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
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

    // Check if ticket can be closed (allow Done status for user feedback)
    if (!['Processing', 'Waiting for Customer', 'Done'].includes(ticket.status)) {
      return res.status(400).json({
        success: false,
        message: 'Ticket không thể được đóng ở trạng thái hiện tại'
      });
    }

    // Create feedback object
    const feedback = {
      assignedTo: ticket.assignedTo,
      rating: ratingNum,
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
      action: TICKET_LOGS.FEEDBACK_ACCEPTED(userName, ratingNum),
      user: userId
    });

    await ticket.save();

    // Send notification to assigned user
    try {
      if (ticket.assignedTo) {
        // TODO: Implement sendFeedbackReceived notification
        // await notificationService.sendFeedbackReceived(ticket, feedback);
        console.log('📢 [Feedback] Feedback accepted, notification to assigned user can be implemented here');
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

    // Get SupportTeamMember by email
    const SupportTeamMember = require("../../models/SupportTeamMember");
    const member = await SupportTeamMember.findOne({ email: user.email }).lean();
    
    if (!member) {
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
            totalTickets: 0,
            completedTickets: 0,
            closedTickets: 0,
            feedbackCount: 0,
            completionRate: 0,
            responseRate: 0
          },
          feedback: {
            averageRating: 0,
            ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
            badges: [],
            badgeCounts: {},
            totalBadges: 0,
            totalUniqueAwards: 0
          }
        }
      });
    }

    // Get ALL tickets assigned to this SupportTeamMember
    // member._id is SupportTeamMember ObjectId, but assignedTo refers to User._id
    // member.userId can be ObjectId or string email (legacy data)
    let assignedToQuery;
    if (member.userId && typeof member.userId === 'object' && member.userId.toString().match(/^[0-9a-fA-F]{24}$/)) {
      // It's a valid ObjectId
      assignedToQuery = member.userId;
    } else if (member.userId && typeof member.userId === 'string') {
      // It's a string, try to find User by email first
      const User = require("../../models/Users");
      const userByEmail = await User.findOne({ email: member.userId }).select('_id').lean();
      if (userByEmail) {
        assignedToQuery = userByEmail._id;
      } else {
        // If userId is string but not found as email, assume it's an ObjectId string
        try {
          assignedToQuery = require('mongoose').Types.ObjectId(member.userId);
        } catch (e) {
          console.log(`[getTeamMemberFeedbackStats] Invalid userId format: ${member.userId}`);
          assignedToQuery = null;
        }
      }
    } else {
      console.log(`[getTeamMemberFeedbackStats] No valid userId for member: ${member.email}`);
      assignedToQuery = null;
    }

    const allTickets = assignedToQuery ? await Ticket.find({
      assignedTo: assignedToQuery
    }).lean() : [];

    const totalTickets = allTickets.length;
    const closedTickets = allTickets.filter(t => t.status === 'Closed').length;
    const completedTickets = allTickets.filter(t => ['Done', 'Closed'].includes(t.status)).length;

    // Get tickets with feedback - check that feedback exists and has rating
    const ticketsWithFeedback = allTickets.filter(t => {
      return t.feedback && 
             typeof t.feedback === 'object' && 
             t.feedback.rating && 
             t.feedback.rating >= 1 && 
             t.feedback.rating <= 5;
    });

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

    // Collect all badges - ensure badges is array
    const allBadges = ticketsWithFeedback
      .filter(t => Array.isArray(t.feedback.badges) && t.feedback.badges.length > 0)
      .flatMap(t => t.feedback.badges);
    
    const badgeCounts = {};
    const totalBadgesCount = allBadges.length;

    // Count badge occurrences
    allBadges.forEach(badge => {
      if (badge) { // Skip empty/null badges
        badgeCounts[badge] = (badgeCounts[badge] || 0) + 1;
      }
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
          totalBadges: totalBadgesCount,
          totalUniqueAwards: uniqueBadges.length
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
        // Get SupportTeamMember by email
        const SupportTeamMember = require("../../models/SupportTeamMember");
        const member = await SupportTeamMember.findOne({ email: user.email }).lean();
        
        // If user is not a support team member, return empty stats
        if (!member) {
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
              totalTickets: 0,
              completedTickets: 0,
              closedTickets: 0,
              feedbackCount: 0,
              completionRate: 0,
              responseRate: 0,
              averageRating: 0
            },
            ratingBreakdown: {
              distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
              topBadges: [],
              totalBadges: 0,
              totalUniqueAwards: 0
            }
          };
        }

        // Get all tickets assigned to this SupportTeamMember
        // member._id is SupportTeamMember ObjectId, but assignedTo refers to User._id
        const allTickets = await Ticket.find({
          assignedTo: member.userId
        }).lean();

        const totalTickets = allTickets.length;
        const closedTickets = allTickets.filter(t => t.status === 'Closed').length;
        const completedTickets = allTickets.filter(t => ['Done', 'Closed'].includes(t.status)).length;

        // Get tickets with feedback - check that feedback exists and has rating
        const ticketsWithFeedback = allTickets.filter(t => {
          return t.feedback && 
                 typeof t.feedback === 'object' && 
                 t.feedback.rating && 
                 t.feedback.rating >= 1 && 
                 t.feedback.rating <= 5;
        });

        let averageRating = 0;
        let ratingDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        let badgeCounts = {};
        let topBadges = [];
        let totalBadgesCount = 0;

        if (ticketsWithFeedback.length > 0) {
          const ratings = ticketsWithFeedback.map(t => t.feedback.rating);
          averageRating = ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length;
          averageRating = Math.round(averageRating * 10) / 10;

          // Rating distribution
          ratings.forEach(rating => {
            ratingDistribution[rating] = (ratingDistribution[rating] || 0) + 1;
          });

          // Collect badges - ensure badges is array
          const allBadges = ticketsWithFeedback
            .filter(t => Array.isArray(t.feedback.badges) && t.feedback.badges.length > 0)
            .flatMap(t => t.feedback.badges);
          
          totalBadgesCount = allBadges.length;

          allBadges.forEach(badge => {
            if (badge) { // Skip empty/null badges
              badgeCounts[badge] = (badgeCounts[badge] || 0) + 1;
            }
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
            topBadges,
            totalBadges: totalBadgesCount,
            totalUniqueAwards: Object.keys(badgeCounts).length
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
 * Get technical stats for a specific user (for email service)
 */
const getTechnicalStatsByUserId = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }

    console.log(`🔍 [getTechnicalStatsByUserId] Getting stats for user: ${userId}`);

    // Find the user
    const user = await User.findById(userId).select('_id email fullname avatarUrl jobTitle department');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if user is a support team member
    const SupportTeamMember = require("../../models/SupportTeamMember");
    const member = await SupportTeamMember.findOne({ email: user.email }).lean();

    if (!member) {
      return res.json({
        success: true,
        data: {
          user: {
            _id: user._id,
            email: user.email,
            fullname: user.fullname,
            avatarUrl: user.avatarUrl || '',
            jobTitle: user.jobTitle || '',
            department: user.department || ''
          },
          summary: {
            totalTickets: 0,
            completedTickets: 0,
            closedTickets: 0,
            feedbackCount: 0,
            completionRate: 0,
            responseRate: 0,
            averageRating: 0
          },
          ratingBreakdown: {
            distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
            topBadges: [],
            totalBadges: 0,
            totalUniqueAwards: 0
          }
        }
      });
    }

    // Get all tickets assigned to this SupportTeamMember
    // Handle both ObjectId and string (email) userId
    let assignedToQuery;

    if (!member.userId) {
      // No userId in support team member, use user._id
      assignedToQuery = user._id;
    } else if (typeof member.userId === 'string') {
      // member.userId is string - could be ObjectId string or email
      if (member.userId.match(/^[0-9a-fA-F]{24}$/)) {
        // It's an ObjectId string
        assignedToQuery = member.userId;
      } else {
        // It's an email string - this shouldn't happen in migrated data
        // But if it does, query for both email (old data) and userId (new data)
        assignedToQuery = { $in: [member.userId, user._id] };
      }
    } else if (typeof member.userId === 'object' && member.userId._id) {
      // member.userId is populated object
      assignedToQuery = member.userId._id;
    } else {
      // Fallback to user._id
      assignedToQuery = user._id;
    }

    console.log(`🔍 [getTechnicalStatsByUserId] Querying tickets with assignedTo:`, assignedToQuery);

    const allTickets = await Ticket.find({
      assignedTo: assignedToQuery
    }).lean();

    const totalTickets = allTickets.length;
    const closedTickets = allTickets.filter(t => t.status === 'Closed').length;
    const completedTickets = allTickets.filter(t => ['Done', 'Closed'].includes(t.status)).length;

    // Get tickets with feedback
    const ticketsWithFeedback = allTickets.filter(t => {
      return t.feedback &&
             typeof t.feedback === 'object' &&
             t.feedback.rating &&
             t.feedback.rating >= 1 &&
             t.feedback.rating <= 5;
    });

    let averageRating = 0;
    let ratingDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let badgeCounts = {};
    let topBadges = [];
    let totalBadgesCount = 0;

    if (ticketsWithFeedback.length > 0) {
      const ratings = ticketsWithFeedback.map(t => t.feedback.rating);
      averageRating = ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length;
      averageRating = Math.round(averageRating * 10) / 10;

      // Rating distribution
      ratings.forEach(rating => {
        ratingDistribution[rating] = (ratingDistribution[rating] || 0) + 1;
      });

      // Collect badges
      const allBadges = ticketsWithFeedback
        .filter(t => Array.isArray(t.feedback.badges) && t.feedback.badges.length > 0)
        .flatMap(t => t.feedback.badges);

      totalBadgesCount = allBadges.length;

      allBadges.forEach(badge => {
        if (badge) {
          badgeCounts[badge] = (badgeCounts[badge] || 0) + 1;
        }
      });

      // Get top 3 badges
      topBadges = Object.entries(badgeCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([badge, count]) => ({ badge, count }));
    }

    const completionRate = totalTickets > 0 ? Math.round((completedTickets / totalTickets) * 100) : 0;
    const responseRate = totalTickets > 0 ? Math.round((allTickets.filter(t => t.status !== 'Assigned').length / totalTickets) * 100) : 0;

    const userStats = {
      user: {
        _id: user._id,
        email: user.email,
        fullname: user.fullname,
        avatarUrl: user.avatarUrl || '',
        jobTitle: user.jobTitle || '',
        department: user.department || ''
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
        topBadges,
        totalBadges: totalBadgesCount,
        totalUniqueAwards: Object.keys(badgeCounts).length
      }
    };

    console.log(`✅ [getTechnicalStatsByUserId] Stats retrieved for ${user.fullname}: ${totalTickets} tickets, avg rating: ${averageRating}`);

    res.json({
      success: true,
      data: userStats
    });

  } catch (error) {
    console.error('❌ Error fetching technical stats for user:', error);
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
  getTechnicalStatsByUserId,
  addFeedback
};
