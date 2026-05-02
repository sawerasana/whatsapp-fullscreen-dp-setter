// ==================== DOM Elements ====================
const step1 = document.getElementById('step-1');
const step2 = document.getElementById('step-2');
const step3 = document.getElementById('step-3');
const successScreen = document.getElementById('successScreen');
const phoneInput = document.getElementById('phoneInput');
const getPairingBtn = document.getElementById('getPairingBtn');
const checkConnectionBtn = document.getElementById('checkConnectionBtn');
const setDpBtn = document.getElementById('setDpBtn');
const startOverBtn = document.getElementById('startOverBtn');
const pairingCodeDisplay = document.getElementById('pairingCodeDisplay');
const imageInput = document.getElementById('imageInput');
const previewBox = document.getElementById('previewBox');
const previewImage = document.getElementById('previewImage');
const messageBox = document.getElementById('messageBox');
const stepsIndicators = document.querySelectorAll('.step');
const infoModal = document.getElementById('infoModal');

let currentSessionId = null;

// ==================== Helper Functions ====================
function showStep(stepElement) {
  [step1, step2, step3, successScreen].forEach(el => el.classList.add('hidden'));
  stepElement.classList.remove('hidden');
}

function updateStepIndicator(stepNumber) {
  stepsIndicators.forEach(ind => {
    const step = ind.dataset.step;
    if (parseInt(step) === stepNumber) {
      ind.classList.add('active');
    } else {
      ind.classList.remove('active');
    }
  });
}

function showMessage(text, isSuccess = false) {
  messageBox.textContent = text;
  messageBox.className = 'message ' + (isSuccess ? 'success' : '');
  messageBox.classList.remove('hidden');
}

function hideMessage() {
  messageBox.classList.add('hidden');
}

function setLoading(button, isLoading) {
  const textSpan = button.querySelector('.btn-text');
  const spinner = button.querySelector('.spinner');
  button.disabled = isLoading;
  if (isLoading) {
    textSpan.style.visibility = 'hidden';
    spinner.classList.remove('hidden');
  } else {
    textSpan.style.visibility = 'visible';
    spinner.classList.add('hidden');
  }
}

// ==================== Open / Close Modal ====================
function openModal() {
  infoModal.classList.remove('hidden');
}
function closeModal() {
  infoModal.classList.add('hidden');
}
// Expose globally for inline onclick
window.openModal = openModal;
window.closeModal = closeModal;

// Show modal on page load once if needed (we'll keep it hidden, user can open via '?' added later, but we'll keep the original structure minimal)
// Add a small info button in header if desired; for simplicity, keep modal accessible via code only.
// We'll add a floating info icon later if needed.

// ==================== Step 1: Get Pairing Code ====================
getPairingBtn.addEventListener('click', async () => {
  const phone = phoneInput.value.trim();
  if (!phone) {
    showMessage('Please enter your WhatsApp number.');
    return;
  }
  // Basic validation: digits only
  if (!/^\d+$/.test(phone)) {
    showMessage('Number must contain only digits, no spaces or special characters.');
    return;
  }
  hideMessage();
  setLoading(getPairingBtn, true);

  try {
    const response = await fetch('/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phoneNumber: phone })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to get pairing code');
    }

    currentSessionId = data.sessionId;
    pairingCodeDisplay.textContent = data.pairingCode;

    // Move to step 2
    showStep(step2);
    updateStepIndicator(2);
  } catch (err) {
    showMessage(err.message);
  } finally {
    setLoading(getPairingBtn, false);
  }
});

// ==================== Step 2: Check Connection ====================
checkConnectionBtn.addEventListener('click', async () => {
  if (!currentSessionId) return;
  setLoading(checkConnectionBtn, true);
  hideMessage();

  try {
    // Poll the connection status
    const checkStatus = async () => {
      const res = await fetch(`/status/${currentSessionId}`);
      const data = await res.json();
      return data.connected;
    };

    // Wait up to 30 seconds
    let connected = false;
    for (let i = 0; i < 30; i++) {
      connected = await checkStatus();
      if (connected) break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    if (connected) {
      showStep(step3);
      updateStepIndicator(3);
      showMessage('Connected! Now choose an image.', true);
    } else {
      showMessage('Connection not established. Make sure you entered the correct code on WhatsApp and try again.');
    }
  } catch (err) {
    showMessage('Error checking connection: ' + err.message);
  } finally {
    setLoading(checkConnectionBtn, false);
  }
});

// ==================== Step 3: Image Upload Preview ====================
imageInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      previewImage.src = ev.target.result;
      previewBox.classList.remove('hidden');
      setDpBtn.disabled = false;
    };
    reader.readAsDataURL(file);
  } else {
    previewBox.classList.add('hidden');
    setDpBtn.disabled = true;
  }
});

// ==================== Set DP ====================
setDpBtn.addEventListener('click', async () => {
  if (!currentSessionId || !imageInput.files[0]) {
    showMessage('Please select an image first.');
    return;
  }

  setLoading(setDpBtn, true);
  hideMessage();

  const formData = new FormData();
  formData.append('sessionId', currentSessionId);
  formData.append('image', imageInput.files[0]);

  try {
    const res = await fetch('/set-dp', {
      method: 'POST',
      body: formData
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to set DP');
    }

    // Success! Show success screen
    showStep(successScreen);
    updateStepIndicator(3); // keep step 3 highlighted or just hide steps
    document.querySelector('.steps').style.display = 'none'; // hide steps on success
  } catch (err) {
    showMessage(err.message);
  } finally {
    setLoading(setDpBtn, false);
  }
});

// ==================== Start Over ====================
startOverBtn.addEventListener('click', () => {
  // Reset UI
  phoneInput.value = '';
  imageInput.value = '';
  previewBox.classList.add('hidden');
  setDpBtn.disabled = true;
  hideMessage();
  currentSessionId = null;
  pairingCodeDisplay.textContent = '------';
  document.querySelector('.steps').style.display = 'flex'; // show steps again
  showStep(step1);
  updateStepIndicator(1);
});
