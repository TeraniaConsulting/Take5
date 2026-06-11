// app.js - Terania Take 5 Safety PWA Main Application Controller

const app = (() => {
  // Global States
  let currentStep = 1; // 1 to 5
  let activeQuestions = [];
  let currentJobNumber = '';
  let currentJobDesc = '';
  let currentCoords = null;
  let gpsAccuracy = null;
  let currentAddress = ''; // Street address resolved via reverse geocoding
  let responses = {}; // Map of qId -> { value: 'yes'|'no'|'na', comment: '', image: '' }
  let db = null;
  let activeSettingsTab = 'checklist';

  // Step information
  const STEPS_INFO = {
    1: { title: "Stop & Think", desc: "Evaluate the task requirements and your physical fitness." },
    2: { title: "Identify Hazards", desc: "Scan your work area for hazards (electricity, heights, plant, etc.)." },
    3: { title: "Assess Risks", desc: "Assess the risk level of the hazards you identified." },
    4: { title: "Control Risks", desc: "Implement controls to eliminate or minimize risks (LOTO, barriers, PPE)." },
    5: { title: "Proceed Safely", desc: "Confirm authorization, emergency plans, and safe startup." }
  };

  // Default questions
  const DEFAULT_QUESTIONS = [
    { id: 'q1', step: 1, text: 'Are you trained, qualified, and authorized to perform this task?', active: true },
    { id: 'q2', step: 1, text: 'Do you feel fit for duty and not impaired by fatigue, illness, or other factors?', active: true },
    { id: 'q3', step: 1, text: 'Do you have all the required tools, equipment, and resources in good working condition?', active: true },
    
    { id: 'q4', step: 2, text: 'Is there a risk of electrical shock, contact with live power, or stored electrical energy?', active: true },
    { id: 'q5', step: 2, text: 'Is there a risk of falling from heights or falling objects hitting personnel below?', active: true },
    { id: 'q6', step: 2, text: 'Are there mobile plants, vehicles, cranes, or machinery operating in the vicinity?', active: true },
    { id: 'q7', step: 2, text: 'Is there exposure to hazardous chemicals, hot surfaces, pressure lines, or toxic dust/fumes?', active: true },
    { id: 'q8', step: 2, text: 'Are there slip, trip, or fall hazards due to uneven ground, wet surfaces, or poor housekeeping?', active: true },
    
    { id: 'q9', step: 3, text: 'Have you assessed the risk level (e.g. High / Medium / Low) of the identified hazards?', active: true },
    { id: 'q10', step: 3, text: 'Does this task require a specialized work permit (e.g. Confined Space, Hot Work, Excavation)?', active: true },
    
    { id: 'q11', step: 4, text: 'Have you implemented isolation, lock-out, tag-out (LOTO), or de-energized the equipment?', active: true },
    { id: 'q12', step: 4, text: 'Are safety signs, barricades, or exclusion zones set up to protect others?', active: true },
    { id: 'q13', step: 4, text: 'Do you have the correct Personal Protective Equipment (PPE) clean and fitted for this task?', active: true },
    
    { id: 'q14', step: 5, text: 'Have you discussed the hazards, risks, and controls with your team or supervisor?', active: true },
    { id: 'q15', step: 5, text: 'Do you know the emergency response plan, location of first aid kits, and evacuation path?', active: true },
    { id: 'q16', step: 5, text: 'Is it safe to proceed with the work now?', active: true }
  ];

  /* ==========================================================================
     DATABASE OPERATIONS (IndexedDB)
     ========================================================================== */
  
  function initDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('TeraniaTake5DB', 1);

      request.onupgradeneeded = event => {
        const localDb = event.target.result;
        // Create store for completed checklists
        if (!localDb.objectStoreNames.contains('checklists')) {
          const store = localDb.createObjectStore('checklists', { keyPath: 'id' });
          store.createIndex('date', 'date', { unique: false });
          store.createIndex('jobNumber', 'jobNumber', { unique: false });
        }
      };

      request.onsuccess = event => {
        db = event.target.result;
        console.log('IndexedDB initialized successfully');
        resolve(db);
      };

      request.onerror = event => {
        console.error('IndexedDB open error:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  function saveChecklistRecord(record) {
    return new Promise((resolve, reject) => {
      if (!db) {
        reject('Database not initialized');
        return;
      }
      const transaction = db.transaction(['checklists'], 'readwrite');
      const store = transaction.objectStore('checklists');
      const request = store.put(record);

      request.onsuccess = () => resolve();
      request.onerror = event => reject(event.target.error);
    });
  }

  function getAllChecklistRecords() {
    return new Promise((resolve, reject) => {
      if (!db) {
        reject('Database not initialized');
        return;
      }
      const transaction = db.transaction(['checklists'], 'readonly');
      const store = transaction.objectStore('checklists');
      const index = store.index('date');
      const request = index.openCursor(null, 'prev'); // Most recent first
      const results = [];

      request.onsuccess = event => {
        const cursor = event.target.result;
        if (cursor) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          resolve(results);
        }
      };

      request.onerror = event => reject(event.target.error);
    });
  }

  function deleteChecklistRecord(id) {
    return new Promise((resolve, reject) => {
      if (!db) {
        reject('Database not initialized');
        return;
      }
      const transaction = db.transaction(['checklists'], 'readwrite');
      const store = transaction.objectStore('checklists');
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = event => reject(event.target.error);
    });
  }

  /* ==========================================================================
     APP INITIALIZATION & ROUTING
     ========================================================================== */

  async function init() {
    try {
      // 1. Initialize DB
      await initDatabase();

      // 2. Load custom/saved questions
      loadQuestions();

      // 3. Register Service Worker for PWA
      registerServiceWorker();

      // 4. Initialize Auth (M365 / Local Bypass)
      const isLoggedIn = await auth.initialize();
      
      // Setup Event Listeners
      setupEventHandlers();

      if (isLoggedIn) {
        setupUserHeader();
        showView('view-dashboard');
        triggerGeolocation();
        loadHistoryList();
      } else {
        showView('view-login');
      }
    } catch (err) {
      console.error('App init failed:', err);
      showToast('App failed to load dependencies. Refreshing may help.', 'error');
    }
  }

  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
          .then(registration => {
            console.log('ServiceWorker registration successful with scope: ', registration.scope);
          })
          .catch(err => {
            console.warn('ServiceWorker registration failed: ', err);
          });
      });
    }
  }

  function showView(viewId) {
    document.querySelectorAll('.view').forEach(view => {
      view.classList.remove('active');
    });
    const activeView = document.getElementById(viewId);
    activeView.classList.add('active');
    
    // Header Visibility Management
    const appHeader = document.getElementById('app-header');
    if (viewId === 'view-login') {
      appHeader.style.display = 'none';
    } else {
      appHeader.style.display = 'flex';
    }
    
    // Scroll back to top on transition
    window.scrollTo(0, 0);
  }

  function setupUserHeader() {
    const user = auth.getCurrentUser();
    if (user) {
      document.getElementById('lbl-user-name').textContent = user.name;
      document.getElementById('lbl-user-role').textContent = user.role;
      document.getElementById('user-avatar').textContent = user.avatarCode;
    }
  }

  /* ==========================================================================
     GEOLOCATION (GPS) INTEGRATION
     ========================================================================== */

  async function reverseGeocode(lat, lng) {
    try {
      // Use OpenStreetMap Nominatim reverse geocoding API
      const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'TeraniaTake5SafetyApp/1.0'
        }
      });
      if (response.ok) {
        const data = await response.json();
        if (data && data.display_name) {
          currentAddress = data.display_name;
          return currentAddress;
        }
      }
    } catch (err) {
      console.warn('Reverse geocoding failed (likely offline):', err);
    }
    currentAddress = '';
    return null;
  }

  function triggerGeolocation() {
    const gpsDot = document.getElementById('gps-status-dot');
    const gpsText = document.getElementById('lbl-gps-coordinates');
    
    gpsDot.className = 'location-dot';
    gpsText.textContent = 'Acquiring GPS location...';
    currentAddress = '';

    if (!navigator.geolocation) {
      gpsText.textContent = 'GPS Geolocation not supported by browser.';
      return;
    }

    const options = {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0
    };

    const handleSuccess = async (position) => {
      currentCoords = {
        lat: position.coords.latitude.toFixed(6),
        lng: position.coords.longitude.toFixed(6)
      };
      gpsAccuracy = position.coords.accuracy.toFixed(1);
      
      gpsDot.className = 'location-dot active';
      gpsText.textContent = `Lat: ${currentCoords.lat}, Lng: ${currentCoords.lng} (Acc: ±${gpsAccuracy}m)`;
      
      // Async reverse geocoding look up
      const address = await reverseGeocode(currentCoords.lat, currentCoords.lng);
      if (address) {
        // Display street components and coordinates in UI
        const parts = address.split(',');
        const shortAddr = parts.slice(0, Math.min(3, parts.length)).join(',').trim();
        gpsText.textContent = `${shortAddr} (Lat: ${currentCoords.lat}, Lng: ${currentCoords.lng})`;
      }
    };

    navigator.geolocation.getCurrentPosition(
      handleSuccess,
      (error) => {
        console.warn('Geolocation error:', error);
        gpsDot.className = 'location-dot';
        
        switch (error.code) {
          case error.PERMISSION_DENIED:
            gpsText.textContent = 'GPS Disabled (Permission Denied)';
            break;
          case error.POSITION_UNAVAILABLE:
            gpsText.textContent = 'GPS Location Unavailable';
            break;
          case error.TIMEOUT:
            gpsText.textContent = 'GPS Timeout (Searching...)';
            // Retry once automatically with lower accuracy
            navigator.geolocation.getCurrentPosition(
              async (pos) => {
                currentCoords = { lat: pos.coords.latitude.toFixed(6), lng: pos.coords.longitude.toFixed(6) };
                gpsAccuracy = pos.coords.accuracy.toFixed(1);
                gpsDot.className = 'location-dot active';
                gpsText.textContent = `Lat: ${currentCoords.lat}, Lng: ${currentCoords.lng} (Acc: ±${gpsAccuracy}m)`;
                
                const address = await reverseGeocode(currentCoords.lat, currentCoords.lng);
                if (address) {
                  const parts = address.split(',');
                  const shortAddr = parts.slice(0, Math.min(3, parts.length)).join(',').trim();
                  gpsText.textContent = `${shortAddr} (Lat: ${currentCoords.lat}, Lng: ${currentCoords.lng})`;
                }
              },
              () => { gpsText.textContent = 'GPS Signal Weak / Offline'; },
              { enableHighAccuracy: false, timeout: 5000 }
            );
            break;
          default:
            gpsText.textContent = 'GPS Error';
        }
      },
      options
    );
  }

  /* ==========================================================================
     CHECKLIST QUESTIONS STORAGE & CONFIGURATION
     ========================================================================== */

  function loadQuestions() {
    const localQs = localStorage.getItem('terania_checklist_questions');
    if (localQs) {
      try {
        activeQuestions = JSON.parse(localQs);
      } catch (e) {
        activeQuestions = [...DEFAULT_QUESTIONS];
      }
    } else {
      activeQuestions = [...DEFAULT_QUESTIONS];
      localStorage.setItem('terania_checklist_questions', JSON.stringify(activeQuestions));
    }
  }

  function saveQuestionsToLocalStorage() {
    localStorage.setItem('terania_checklist_questions', JSON.stringify(activeQuestions));
  }

  function renderChecklistSettings() {
    const listContainer = document.getElementById('list-settings-questions');
    listContainer.innerHTML = '';

    // Group questions by step
    for (let step = 1; step <= 5; step++) {
      const stepTitle = document.createElement('h3');
      stepTitle.className = 'text-primary mt-1 mb-1';
      stepTitle.style.borderBottom = '1px solid var(--color-border)';
      stepTitle.style.paddingBottom = '0.25rem';
      stepTitle.style.fontSize = '0.95rem';
      stepTitle.textContent = `Step ${step}: ${STEPS_INFO[step].title}`;
      listContainer.appendChild(stepTitle);

      const stepQs = activeQuestions.filter(q => q.step === step);
      
      stepQs.forEach(q => {
        const item = document.createElement('div');
        item.className = 'config-question-item';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = q.active;
        checkbox.id = `cfg-chk-${q.id}`;
        checkbox.addEventListener('change', () => {
          q.active = checkbox.checked;
          saveQuestionsToLocalStorage();
          showToast('Question status updated', 'success');
        });

        const textSpan = document.createElement('span');
        textSpan.className = 'config-question-item-text';
        textSpan.textContent = q.text;

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'config-question-item-actions';

        // Custom questions can be deleted
        if (!DEFAULT_QUESTIONS.some(dq => dq.id === q.id)) {
          const deleteBtn = document.createElement('button');
          deleteBtn.className = 'text-btn text-danger';
          deleteBtn.textContent = 'Delete';
          deleteBtn.addEventListener('click', () => {
            activeQuestions = activeQuestions.filter(aq => aq.id !== q.id);
            saveQuestionsToLocalStorage();
            renderChecklistSettings();
            showToast('Custom question removed', 'success');
          });
          actionsDiv.appendChild(deleteBtn);
        }

        item.appendChild(checkbox);
        item.appendChild(textSpan);
        item.appendChild(actionsDiv);
        listContainer.appendChild(item);
      });

      if (stepQs.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'text-neutral text-center mb-1';
        empty.style.fontSize = '0.85rem';
        empty.textContent = 'No questions in this category';
        listContainer.appendChild(empty);
      }
    }
  }

  function addCustomQuestion(step, text) {
    if (!text.trim()) {
      showToast('Question text cannot be empty', 'error');
      return;
    }
    const newId = 'custom_' + Date.now();
    activeQuestions.push({
      id: newId,
      step: parseInt(step),
      text: text.trim(),
      active: true
    });
    saveQuestionsToLocalStorage();
    renderChecklistSettings();
    showToast('Custom question added', 'success');
    document.getElementById('input-new-q-text').value = '';
  }

  function switchSettingsTab(tabName) {
    activeSettingsTab = tabName;
    document.getElementById('tab-btn-checklist').classList.toggle('active', tabName === 'checklist');
    document.getElementById('tab-btn-email').classList.toggle('active', tabName === 'email');
    
    document.getElementById('pane-settings-checklist').classList.toggle('active', tabName === 'checklist');
    document.getElementById('pane-settings-email').classList.toggle('active', tabName === 'email');

    if (tabName === 'checklist') {
      renderChecklistSettings();
    } else {
      // Load Office Email settings
      const officeEmail = localStorage.getItem('terania_office_email') || 'safety@terania.com.au';
      document.getElementById('input-office-email').value = officeEmail;
    }
  }

  /* ==========================================================================
     CHECKLIST WIZARD FLOW
     ========================================================================== */

  function startWizard() {
    currentJobNumber = document.getElementById('input-job-number').value.trim();
    currentJobDesc = document.getElementById('input-job-desc').value.trim();

    if (!currentJobNumber) {
      showToast('Please enter a Job Number to start', 'error');
      return;
    }

    // Refresh questions
    loadQuestions();

    // Reset checklist variables
    currentStep = 1;
    responses = {};
    activeQuestions.forEach(q => {
      if (q.active) {
        responses[q.id] = { value: '', comment: '', image: '' };
      }
    });

    renderWizardStep();
    showView('view-checklist');
  }

  function renderWizardStep() {
    const stepInfo = STEPS_INFO[currentStep];
    document.getElementById('lbl-wizard-step-header').textContent = `Step ${currentStep} of 5`;
    document.getElementById('lbl-wizard-step-title').textContent = stepInfo.title;
    document.getElementById('lbl-wizard-step-desc').textContent = stepInfo.desc;

    // Progress Bar
    const progressPercent = ((currentStep - 1) / 5) * 100;
    document.getElementById('checklist-progress-bar').style.width = `${progressPercent}%`;

    // Questions Container
    const container = document.getElementById('container-step-questions');
    container.innerHTML = '';

    const stepQuestions = activeQuestions.filter(q => q.step === currentStep && q.active);

    if (stepQuestions.length === 0) {
      const infoBox = document.createElement('div');
      infoBox.className = 'empty-state';
      infoBox.innerHTML = '<p>No active checklist items for this step. Click Next to proceed.</p>';
      container.appendChild(infoBox);
    } else {
      stepQuestions.forEach(q => {
        const card = document.createElement('div');
        card.className = 'question-card';
        card.id = `q-card-${q.id}`;
        
        // Restore previous response state
        const savedResponse = responses[q.id] || { value: '', comment: '', image: '' };
        if (savedResponse.value === 'no') {
          card.classList.add('flagged');
        }

        const text = document.createElement('div');
        text.className = 'question-text';
        text.textContent = q.text;
        card.appendChild(text);

        // Option Selector Buttons
        const selector = document.createElement('div');
        selector.className = 'option-selector';

        const optYes = document.createElement('button');
        optYes.className = 'option-btn';
        optYes.textContent = 'YES';
        optYes.setAttribute('data-value', 'yes');
        if (savedResponse.value === 'yes') optYes.classList.add('selected');

        const optNo = document.createElement('button');
        optNo.className = 'option-btn';
        optNo.textContent = 'NO';
        optNo.setAttribute('data-value', 'no');
        if (savedResponse.value === 'no') optNo.classList.add('selected');

        const optNa = document.createElement('button');
        optNa.className = 'option-btn';
        optNa.textContent = 'N/A';
        optNa.setAttribute('data-value', 'na');
        if (savedResponse.value === 'na') optNa.classList.add('selected');

        selector.appendChild(optYes);
        selector.appendChild(optNo);
        selector.appendChild(optNa);
        card.appendChild(selector);

        // Details Panel (Comment & Photo)
        const details = document.createElement('div');
        details.className = 'question-details';
        details.id = `q-details-${q.id}`;
        if (savedResponse.value !== '') {
          details.classList.add('active');
        }

        const commentBox = document.createElement('textarea');
        commentBox.className = 'form-input';
        commentBox.style.height = '65px';
        commentBox.placeholder = 'Add details or comments here...';
        commentBox.value = savedResponse.comment;
        commentBox.addEventListener('input', (e) => {
          responses[q.id].comment = e.target.value;
        });

        // Photo Upload Container
        const uploadWrapper = document.createElement('div');
        uploadWrapper.className = 'image-upload-wrapper';

        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*';
        fileInput.id = `q-file-input-${q.id}`;
        fileInput.style.display = 'none';

        const uploadBtn = document.createElement('label');
        uploadBtn.className = 'image-upload-btn';
        uploadBtn.htmlFor = `q-file-input-${q.id}`;
        uploadBtn.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
            <circle cx="12" cy="13" r="4"></circle>
          </svg>
          Photo
        `;

        const previewSlot = document.createElement('div');
        previewSlot.className = 'image-preview-slot';
        previewSlot.id = `q-preview-${q.id}`;
        
        const previewImg = document.createElement('img');
        previewImg.id = `q-preview-img-${q.id}`;
        if (savedResponse.image) {
          previewImg.src = savedResponse.image;
          previewSlot.style.display = 'block';
        }
        
        const removeBtn = document.createElement('button');
        removeBtn.className = 'image-remove-btn';
        removeBtn.textContent = '✕';
        removeBtn.addEventListener('click', (e) => {
          e.preventDefault();
          responses[q.id].image = '';
          previewSlot.style.display = 'none';
          previewImg.removeAttribute('src');
          fileInput.value = '';
        });

        previewSlot.appendChild(previewImg);
        previewSlot.appendChild(removeBtn);

        fileInput.addEventListener('change', (e) => {
          const file = e.target.files[0];
          if (file) {
            compressAndSaveImage(file, q.id);
          }
        });

        uploadWrapper.appendChild(fileInput);
        uploadWrapper.appendChild(uploadBtn);
        uploadWrapper.appendChild(previewSlot);

        details.appendChild(commentBox);
        details.appendChild(uploadWrapper);
        card.appendChild(details);

        // Hook up option selection button events
        const optionBtns = [optYes, optNo, optNa];
        optionBtns.forEach(btn => {
          btn.addEventListener('click', () => {
            // Remove selection class from siblings
            optionBtns.forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');

            const val = btn.getAttribute('data-value');
            responses[q.id].value = val;

            // Highlight hazard red if answered NO
            if (val === 'no') {
              card.classList.add('flagged');
            } else {
              card.classList.remove('flagged');
            }

            // Always display details input on selection
            details.classList.add('active');
          });
        });

        container.appendChild(card);
      });
    }

    // Wizard footer buttons text
    const nextBtn = document.getElementById('btn-wizard-next');
    if (currentStep === 5) {
      nextBtn.innerHTML = `
        Submit Report
        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="7 10 12 15 17 10"></polyline>
          <line x1="12" y1="15" x2="12" y2="3"></line>
        </svg>
      `;
    } else {
      nextBtn.innerHTML = `
        Next
        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round">
          <line x1="5" y1="12" x2="19" y2="12"></line>
          <polyline points="12 5 19 12 12 19"></polyline>
        </svg>
      `;
    }

    // Hide Back button on Step 1
    document.getElementById('btn-wizard-back').style.visibility = currentStep === 1 ? 'hidden' : 'visible';
  }

  /**
   * Resizes large images on client canvas to save DB space and prevent PDF generation crashes
   */
  function compressAndSaveImage(file, qId) {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = event => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 450;
        const MAX_HEIGHT = 450;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        
        // Export to lower-quality JPEG
        const base64Str = canvas.toDataURL('image/jpeg', 0.65);
        
        // Save in state
        responses[qId].image = base64Str;
        
        // Render UI preview
        const slot = document.getElementById(`q-preview-${qId}`);
        const pImg = document.getElementById(`q-preview-img-${qId}`);
        pImg.src = base64Str;
        slot.style.display = 'block';
      };
    };
  }

  function handleWizardNext() {
    // Validate current step questions
    const stepQuestions = activeQuestions.filter(q => q.step === currentStep && q.active);
    const unanswered = stepQuestions.filter(q => !responses[q.id] || !responses[q.id].value);

    if (unanswered.length > 0) {
      showToast('Please answer all questions in this step before continuing.', 'error');
      // Shake or highlight unanswered question card
      unanswered.forEach(q => {
        const card = document.getElementById(`q-card-${q.id}`);
        if (card) {
          card.style.animation = 'none';
          setTimeout(() => {
            card.style.border = '2px solid var(--color-danger)';
            card.style.boxShadow = '0 0 10px rgba(217,56,56,0.1)';
          }, 10);
        }
      });
      return;
    }

    if (currentStep < 5) {
      currentStep++;
      renderWizardStep();
    } else {
      // Step 5 Submit
      submitChecklist();
    }
  }

  function handleWizardBack() {
    if (currentStep > 1) {
      currentStep--;
      renderWizardStep();
    }
  }

  async function submitChecklist() {
    try {
      const user = auth.getCurrentUser();
      const submissionDate = new Date();
      
      const record = {
        id: 'take5_' + submissionDate.getTime(),
        jobNumber: currentJobNumber,
        jobDesc: currentJobDesc,
        date: submissionDate.toISOString(),
        userName: user.name,
        userEmail: user.email,
        location: currentCoords ? `${currentCoords.lat}, ${currentCoords.lng} (Acc: ±${gpsAccuracy}m)` : 'GPS Location Denied/Unavailable',
        address: currentAddress || '',
        responses: activeQuestions.map(q => {
          return {
            id: q.id,
            step: q.step,
            text: q.text,
            active: q.active,
            value: responses[q.id] ? responses[q.id].value : 'na',
            comment: responses[q.id] ? responses[q.id].comment : '',
            image: responses[q.id] ? responses[q.id].image : ''
          };
        })
      };

      // 1. Save to Database
      await saveChecklistRecord(record);
      showToast('Checklist saved to device', 'success');

      // 2. Generate PDF download
      const pdfData = await downloadChecklistPDF(record, true);
      
      // 3. Immediately trigger email client back to office (attaching PDF if supported)
      await emailChecklistRecord(record, pdfData);

      // 4. Reset and Return
      document.getElementById('input-job-number').value = '';
      document.getElementById('input-job-desc').value = '';
      showView('view-dashboard');
      loadHistoryList();
    } catch (err) {
      console.error('Error saving checklist:', err);
      showToast('Error saving checklist: ' + err.message, 'error');
    }
  }

  /* ==========================================================================
     PDF GENERATION (jsPDF Implementation)
     ========================================================================== */

  function getBase64Image(imgEl) {
    const canvas = document.createElement('canvas');
    canvas.width = imgEl.naturalWidth || imgEl.width;
    canvas.height = imgEl.naturalHeight || imgEl.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(imgEl, 0, 0);
    return canvas.toDataURL('image/png');
  }

  async function downloadChecklistPDF(record, shouldDownload = true) {
    if (shouldDownload) {
      showToast('Generating PDF report...', 'info');
    }

    // Create jsPDF instance
    const { jsPDF } = window.jspdf;
    // Standard A4 dimensions: 210mm x 297mm
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    const primaryColor = [0, 84, 69];    // Terania Dark Green (#005445)
    const successColor = [55, 129, 61];  // Terania Light Green (#37813d)
    const dangerColor = [217, 56, 56];   // Hazard Red
    const grayColor = [120, 130, 128];   // Neutral Gray
    const lightBgColor = [242, 231, 206]; // Sand (#f2e7ce)

    let yOffset = 15;

    // 1. Draw top brand banner (Dark Green background)
    pdf.setFillColor(...primaryColor);
    pdf.rect(0, 0, 210, 35, 'F');

    // 2. Embed Terania Logo into Header Banner
    try {
      // Fetch header logo element from DOM (pre-loaded source)
      const logoEl = document.getElementById('img-header-logo');
      const logoBase64 = getBase64Image(logoEl);
      // Horizontal logo aspect ratio is approx 4:1 (width: height)
      pdf.addImage(logoBase64, 'PNG', 15, 6, 48, 12);
    } catch (e) {
      console.warn('Could not load logo into PDF:', e);
      // Fallback text logo
      pdf.setTextColor(255, 255, 255);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(22);
      pdf.text('TERANIA', 15, 15);
    }

    // 3. Document Title inside Banner
    pdf.setTextColor(255, 255, 255);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(16);
    pdf.text('TAKE 5 SAFETY CHECKLIST', 115, 15);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.text('Field Risk Assessment & Hazard Control', 115, 21);

    // Sand underline accent in header
    pdf.setFillColor(...lightBgColor);
    pdf.rect(0, 32, 210, 3, 'F');

    yOffset = 45;

    // 4. Job Metadata Card (expanded height from 32 to 38 to fit address lines)
    pdf.setFillColor(245, 247, 246);
    pdf.rect(12, yOffset, 186, 38, 'F');
    pdf.setDrawColor(224, 230, 228);
    pdf.rect(12, yOffset, 186, 38, 'D');

    pdf.setTextColor(...primaryColor);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(10);
    pdf.text('JOB AND OPERATOR DETAILS', 16, yOffset + 6);

    pdf.setTextColor(0, 0, 0);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);

    const formattedDate = new Date(record.date).toLocaleString('en-AU', {
      dateStyle: 'medium',
      timeStyle: 'short'
    });

    pdf.text(`Job Number:   ${record.jobNumber}`, 16, yOffset + 13);
    pdf.text(`Description:  ${record.jobDesc || 'N/A'}`, 16, yOffset + 19);
    pdf.text(`Date & Time:  ${formattedDate}`, 16, yOffset + 25);

    pdf.text(`Completed By: ${record.userName} (${record.userEmail})`, 105, yOffset + 13);
    pdf.text(`GPS Location: ${record.location}`, 105, yOffset + 19);
    
    // Render reverse geocoded street address in the PDF card
    if (record.address) {
      pdf.setFontSize(8);
      pdf.setTextColor(80, 80, 80);
      const addrLines = pdf.splitTextToSize(`Address: ${record.address}`, 90);
      for (let l = 0; l < Math.min(2, addrLines.length); l++) {
        pdf.text(addrLines[l], 105, yOffset + 25 + (l * 4.5));
      }
    }

    yOffset += 46;

    // 5. Checklist Headers
    pdf.setFillColor(...primaryColor);
    pdf.rect(12, yOffset, 186, 6, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9);
    pdf.text('CHECKLIST QUESTION / QUERY', 16, yOffset + 4.5);
    pdf.text('RESPONSE', 180, yOffset + 4.5, { align: 'right' });

    yOffset += 6;

    // 6. Checklist Items
    let pageNum = 1;
    
    // Group active responses
    const filteredResponses = record.responses.filter(r => r.active);
    
    for (let index = 0; index < filteredResponses.length; index++) {
      const resp = filteredResponses[index];

      // Page boundary check: If close to page end, add new page
      if (yOffset > 255) {
        addPDFPageFooter(pdf, pageNum);
        pdf.addPage();
        pageNum++;
        
        // Re-draw brand top line on secondary page
        pdf.setFillColor(...primaryColor);
        pdf.rect(0, 0, 210, 8, 'F');
        pdf.setFillColor(...lightBgColor);
        pdf.rect(0, 8, 210, 2, 'F');
        yOffset = 18;
      }

      pdf.setTextColor(0, 0, 0);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(8.5);

      // Wrap question text to prevent overflow
      const questionLines = pdf.splitTextToSize(`${resp.step}. ${resp.text}`, 148);
      const lineCount = questionLines.length;
      
      // Print question text
      for (let l = 0; l < lineCount; l++) {
        pdf.text(questionLines[l], 16, yOffset + 4.5 + (l * 4.5));
      }

      // Draw color-coded badge indicator for answers
      const statusText = resp.value.toUpperCase();
      pdf.setFont('helvetica', 'bold');
      if (resp.value === 'yes') {
        pdf.setTextColor(...successColor);
      } else if (resp.value === 'no') {
        pdf.setTextColor(...dangerColor);
      } else {
        pdf.setTextColor(...grayColor);
      }
      pdf.text(statusText, 180, yOffset + 4.5, { align: 'right' });

      // Determine height increment for this block
      let rowHeight = Math.max(8, (lineCount * 4.5) + 2);
      
      // Render Comments (if present)
      if (resp.comment) {
        pdf.setTextColor(80, 80, 80);
        pdf.setFont('helvetica', 'italic');
        pdf.setFontSize(8);
        const commentLines = pdf.splitTextToSize(`Comment: ${resp.comment}`, 140);
        
        for (let l = 0; l < commentLines.length; l++) {
          pdf.text(commentLines[l], 22, yOffset + rowHeight + (l * 3.5));
        }
        rowHeight += (commentLines.length * 3.5) + 1.5;
      }

      // Render Photo (if present)
      if (resp.image) {
        // Space checking for image (requires at least 45mm space)
        if (yOffset + rowHeight + 45 > 275) {
          addPDFPageFooter(pdf, pageNum);
          pdf.addPage();
          pageNum++;
          
          pdf.setFillColor(...primaryColor);
          pdf.rect(0, 0, 210, 8, 'F');
          pdf.setFillColor(...lightBgColor);
          pdf.rect(0, 8, 210, 2, 'F');
          
          yOffset = 18;
          rowHeight = 2;
        }

        try {
          // Add image inside PDF border box (resized to fit, e.g. 50mm x 35mm)
          pdf.setFillColor(240, 240, 240);
          pdf.rect(22, yOffset + rowHeight, 52, 37, 'F');
          pdf.setDrawColor(210, 210, 210);
          pdf.rect(22, yOffset + rowHeight, 52, 37, 'D');
          
          pdf.addImage(resp.image, 'JPEG', 23, yOffset + rowHeight + 1, 50, 35);
          rowHeight += 40;
        } catch (imgErr) {
          console.error('Failed drawing image in PDF:', imgErr);
        }
      }

      // Bottom cell border line
      pdf.setDrawColor(230, 235, 233);
      pdf.line(12, yOffset + rowHeight, 198, yOffset + rowHeight);

      yOffset += rowHeight;
    }

    // Add Signature and Sign off block
    if (yOffset > 230) {
      addPDFPageFooter(pdf, pageNum);
      pdf.addPage();
      pageNum++;
      
      pdf.setFillColor(...primaryColor);
      pdf.rect(0, 0, 210, 8, 'F');
      pdf.setFillColor(...lightBgColor);
      pdf.rect(0, 8, 210, 2, 'F');
      yOffset = 18;
    }

    yOffset += 12;
    pdf.setFillColor(248, 249, 248);
    pdf.rect(12, yOffset, 186, 26, 'F');
    pdf.setDrawColor(220, 224, 222);
    pdf.rect(12, yOffset, 186, 26, 'D');

    pdf.setTextColor(...primaryColor);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8);
    pdf.text('DECLARATION / COMPLIANCE SIGN-OFF', 16, yOffset + 5);

    pdf.setTextColor(0, 0, 0);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.5);
    pdf.text('I declare that the information provided is correct and the site risks have been evaluated prior to starting this job.', 16, yOffset + 11);

    pdf.setFont('helvetica', 'bold');
    pdf.text(`Operator Signature: ${record.userName} (Electronically Signed)`, 16, yOffset + 18);
    pdf.text(`Audit Trail ID: ${record.id}`, 105, yOffset + 18);

    addPDFPageFooter(pdf, pageNum);

    // Save and download PDF
    const filename = `Terania_Take5_${record.jobNumber}_${new Date(record.date).toISOString().slice(0,10)}.pdf`;
    if (shouldDownload) {
      pdf.save(filename);
      showToast('Report downloaded successfully!', 'success');
    }
    
    return { pdf, filename };
  }

  async function emailChecklistRecord(record, pdfData = null) {
    const recipientEmail = record.userEmail || 'safety@terania.com.au';
    const formattedDate = new Date(record.date).toLocaleString('en-AU', {
      dateStyle: 'medium',
      timeStyle: 'short'
    });

    const subjectText = `Take 5 Safety Report - Job #${record.jobNumber} (${record.userName})`;
    const subject = encodeURIComponent(subjectText);
    
    // Count hazards flagged (responses where value is 'no')
    const hazards = record.responses.filter(r => r.active && r.value === 'no');
    let hazardsSummary = '';
    
    if (hazards.length === 0) {
      hazardsSummary = '✅ ALL OK - No hazards or warning flags were identified.';
    } else {
      hazardsSummary = `⚠️ WARNING - ${hazards.length} HAZARD(S) FLAGGED:\n`;
      hazards.forEach(h => {
        hazardsSummary += `  * Step ${h.step}: ${h.text}\n    - Action/Comment: ${h.comment || 'None provided'}\n`;
      });
    }

    // Build plain text email body
    let bodyText = `Hi Team,

Please find the summary of the Take 5 Safety checklist completed for Terania below.

JOB DETAILS:
- Job Number: ${record.jobNumber}
- Description: ${record.jobDesc || 'N/A'}
- Date & Time: ${formattedDate}
- GPS Location: ${record.location}
${record.address ? `- Street Address: ${record.address}\n` : ''}
OPERATOR DETAILS:
- Name: ${record.userName}
- Email: ${record.userEmail}
- Role: ${record.role || 'Field Operator'}

HAZARD ASSESSMENT SUMMARY:
${hazardsSummary}

--------------------------------------------------
IMPORTANT: Please find the full PDF report document attached to this email. If not attached, please upload the file:
Terania_Take5_${record.jobNumber}_${new Date(record.date).toISOString().slice(0,10)}.pdf

Completed via Terania Take 5 Safety PWA compliance tool.
Audit Trail ID: ${record.id}
`;

    let shared = false;
    // Try Web Share API for native attachments (supported on Android/iOS/Safari/macOS)
    if (navigator.share && navigator.canShare) {
      try {
        if (!pdfData) {
          pdfData = await downloadChecklistPDF(record, false);
        }
        const pdfBlob = pdfData.pdf.output('blob');
        const pdfFile = new File([pdfBlob], pdfData.filename, { type: 'application/pdf' });
        
        if (navigator.canShare({ files: [pdfFile] })) {
          await navigator.share({
            files: [pdfFile],
            title: subjectText,
            text: bodyText
          });
          shared = true;
          showToast('Report shared successfully with attachment!', 'success');
        }
      } catch (shareErr) {
        console.warn('Web Share failed, falling back to mailto:', shareErr);
      }
    }

    if (!shared) {
      // Fallback to standard mailto link
      const body = encodeURIComponent(bodyText);
      const mailtoUrl = `mailto:${recipientEmail}?subject=${subject}&body=${body}`;
      window.location.href = mailtoUrl;
      showToast('Mail client launched. Please attach the downloaded PDF!', 'success');
    }
  }

  function addPDFPageFooter(pdf, pageNum) {
    pdf.setTextColor(140, 150, 148);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.5);
    pdf.text('TERANIA APPS - TAKE 5 SAFETY PWA COMPLIANCE TOOL', 12, 287);
    pdf.text(`Page ${pageNum}`, 198, 287, { align: 'right' });
  }

  /* ==========================================================================
     HISTORY LIST LOADER
     ========================================================================== */

  async function loadHistoryList() {
    const historyList = document.getElementById('dashboard-history-list');
    if (!historyList) return;

    try {
      const records = await getAllChecklistRecords();

      if (records.length === 0) {
        historyList.innerHTML = `
          <div class="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
            </svg>
            <p>No checklists completed yet.</p>
          </div>
        `;
        return;
      }

      historyList.innerHTML = '';
      records.forEach(record => {
        const item = document.createElement('div');
        item.className = 'history-item';
        
        const details = document.createElement('div');
        details.className = 'history-item-details';

        const title = document.createElement('span');
        title.className = 'history-item-title';
        title.textContent = `Job #${record.jobNumber}`;

        const meta = document.createElement('span');
        meta.className = 'history-item-meta';
        const dateStr = new Date(record.date).toLocaleDateString('en-AU', {
          day: '2-digit',
          month: 'short',
          year: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        });
        meta.textContent = `${dateStr} | ${record.jobDesc || 'No Description'}`;

        details.appendChild(title);
        details.appendChild(meta);

        const actionsContainer = document.createElement('div');
        actionsContainer.className = 'history-item-actions';
        actionsContainer.style.display = 'flex';
        actionsContainer.style.gap = '0.4rem';

        // Download Action Button
        const dlBtn = document.createElement('button');
        dlBtn.className = 'btn btn-outline btn-sm';
        dlBtn.style.padding = '0.4rem 0.6rem';
        dlBtn.innerHTML = `
          <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          PDF
        `;
        dlBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          downloadChecklistPDF(record);
        });

        // Email Action Button
        const emailBtn = document.createElement('button');
        emailBtn.className = 'btn btn-secondary btn-sm';
        emailBtn.style.padding = '0.4rem 0.6rem';
        emailBtn.style.border = '1px solid var(--color-primary)';
        emailBtn.innerHTML = `
          <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
            <polyline points="22,6 12,13 2,6"></polyline>
          </svg>
          Email
        `;
        emailBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          emailChecklistRecord(record);
        });

        actionsContainer.appendChild(dlBtn);
        actionsContainer.appendChild(emailBtn);

        item.appendChild(details);
        item.appendChild(actionsContainer);
        historyList.appendChild(item);
      });
    } catch (err) {
      console.error('Error loading history list:', err);
    }
  }

  /* ==========================================================================
     GLOBAL TOAST NOTIFICATIONS
     ========================================================================== */

  function showToast(message, type = 'success') {
    const toast = document.getElementById('global-toast');
    const toastMsg = document.getElementById('toast-message');
    
    toast.className = `toast show ${type}`;
    toastMsg.textContent = message;

    setTimeout(() => {
      toast.classList.remove('show');
    }, 3500);
  }

  /* ==========================================================================
     EVENT HANDLERS BINDINGS
     ========================================================================== */

  function setupEventHandlers() {
    // 1. Operator Profile Sign In submit
    document.getElementById('form-operator-login').addEventListener('submit', (e) => {
      e.preventDefault();
      const name = document.getElementById('input-login-name').value.trim();
      const email = document.getElementById('input-login-email').value.trim();
      const role = document.getElementById('select-login-role').value;
      
      try {
        auth.login(name, email, role);
        setupUserHeader();
        showView('view-dashboard');
        triggerGeolocation();
        loadHistoryList();
        showToast('Signed in successfully', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    document.getElementById('btn-logout').addEventListener('click', () => {
      auth.logout();
    });

    // 2. Settings Views Triggers
    document.getElementById('btn-open-settings').addEventListener('click', () => {
      switchSettingsTab('checklist');
      showView('view-settings');
    });

    document.getElementById('btn-settings-close').addEventListener('click', () => {
      showView('view-dashboard');
      triggerGeolocation();
      loadHistoryList();
    });

    // 3. Checklist Settings Manager
    document.getElementById('btn-add-custom-question').addEventListener('click', () => {
      const stepSelect = document.getElementById('select-new-q-step');
      const textInput = document.getElementById('input-new-q-text');
      addCustomQuestion(stepSelect.value, textInput.value);
    });

    document.getElementById('btn-save-email-settings').addEventListener('click', () => {
      const email = document.getElementById('input-office-email').value.trim();
      if (email) {
        localStorage.setItem('terania_office_email', email);
        showToast('Recipient office email saved!', 'success');
      } else {
        showToast('Please enter a valid email address', 'error');
      }
    });

    // 4. GPS Location Refetch Trigger
    document.getElementById('btn-refetch-gps').addEventListener('click', () => {
      triggerGeolocation();
    });

    // 5. Checklist Setup Wizard Initiator
    document.getElementById('btn-start-checklist').addEventListener('click', () => {
      startWizard();
    });

    // 6. Checklist Navigation controls
    document.getElementById('btn-wizard-back').addEventListener('click', () => {
      handleWizardBack();
    });

    document.getElementById('btn-wizard-next').addEventListener('click', () => {
      handleWizardNext();
    });
  }

  // Export public variables/functions
  return {
    init,
    switchSettingsTab
  };
})();

// Document Ready Bootstrap
document.addEventListener('DOMContentLoaded', () => {
  app.init();
});
