import { renderPlans } from './ui.js';
import { paymentsActive } from './config.js';
renderPlans(document.getElementById('plans'));
document.getElementById('payments-note').hidden = paymentsActive();
