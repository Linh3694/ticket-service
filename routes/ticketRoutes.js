const express = require('express');
const router = express.Router();
const ticketController = require('../controllers/ticketController');

// Standard REST API routes
router.post('/create', ticketController.createTicket.bind(ticketController));
router.get('/', ticketController.getTickets.bind(ticketController));
router.get('/:ticket_id', ticketController.getTicket.bind(ticketController));
router.put('/:ticket_id', ticketController.updateTicket.bind(ticketController));
router.post('/:ticket_id/assign', ticketController.assignTicket.bind(ticketController));
router.post('/:ticket_id/resolve', ticketController.resolveTicket.bind(ticketController));
router.get('/user/:user_id', ticketController.getUserTickets.bind(ticketController));
router.get('/stats/overview', ticketController.getTicketStats.bind(ticketController));

// Frappe-compatible API routes
router.post('/erp.it.doctype.erp_ticket.erp_ticket.create_ticket', 
  ticketController.createTicket.bind(ticketController));

router.get('/erp.it.doctype.erp_ticket.erp_ticket.get_user_tickets', 
  ticketController.getUserTickets.bind(ticketController));

// Frappe resource API
router.get('/ERP%20Ticket', async (req, res) => {
  req.query = { ...req.query, ...JSON.parse(req.query.filters || '{}') };
  await ticketController.getTickets(req, res);
});

router.get('/ERP%20Ticket/:name', async (req, res) => {
  req.params.ticket_id = req.params.name;
  await ticketController.getTicket(req, res);
});

router.post('/ERP%20Ticket', async (req, res) => {
  const database = require('../config/database');
  const data = req.body;
  
  data.name = data.name || `TICKET-${Date.now()}`;
  data.creation = new Date().toISOString();
  data.modified = new Date().toISOString();
  data.owner = 'Administrator';
  data.modified_by = 'Administrator';
  data.docstatus = 0;
  data.idx = 0;

  await database.insert('ERP Ticket', data);
  res.json({ message: data, status: 'success' });
});

router.put('/ERP%20Ticket/:name', async (req, res) => {
  req.params.ticket_id = req.params.name;
  await ticketController.updateTicket(req, res);
});

module.exports = router;