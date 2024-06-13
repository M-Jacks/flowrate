document.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.getElementById('loginForm');
  const signupForm = document.getElementById('signupForm');
  const loginMessage = document.getElementById('loginMessage');
  const signupMessage = document.getElementById('signupMessage');
  const wrapper = document.querySelector('.wrapper');
  const loginLink = document.querySelector('.login-link');
  const registerLink = document.querySelector('.register-link');
  const btnPopup = document.querySelector('.btnLogin-popup');
  const iconClose = document.querySelector('.icon-close');

  // Function to display messages for login and signup forms
  const displayMessage = (message, element, type) => {
    element.textContent = message;
    element.className = `message ${type}`;
    element.style.display = 'block';
    setTimeout(() => {
      element.style.display = 'none';
    }, 3000);  // Increased display time to 3 seconds for better user experience
  };

  // Event listener for the login form submission
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault(); // Prevent the default form submission behavior
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    
    try {
      // Send a POST request to the server for login
      const response = await fetch('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const result = await response.json();
      if (response.ok) {
        // If login is successful, display success message and redirect to products page
        displayMessage(result.message, loginMessage, 'success');
        setTimeout(() => {
          window.location.href = '/products';
        }, 1000);
      } else {
        // If login fails and user is not registered, show the registration form
        if (result.message === 'Account does not exist') {
          setTimeout(() => {
            wrapper.classList.add('active');
          }, 500);
        }
        displayMessage(result.message, loginMessage, 'error');
      }
    } catch (error) {
      // Handle errors during login process
      displayMessage('An error occurred during login', loginMessage, 'error');
    }
  });

  // Event listener for the signup form submission
  signupForm.addEventListener('submit', async (e) => {
    e.preventDefault(); // Prevent the default form submission behavior
    e.preventDefault(); // Prevent the default form submission behavior
    const firstName = document.getElementById('FirstName').value;
    const lastName  = document.getElementById('LastName').value;
    const email = document.getElementById('signupEmail').value;
    const password = document.getElementById('signupPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;

    const allowedDomain = 'sunculture.com'; // Set the allowed email domain 
    const emailDomain = email.split('@')[1];

    // Check if the email domain is allowed
    if (emailDomain !== allowedDomain) {
      displayMessage('Email not allowed!', signupMessage, 'error');
      return;
    }

    // Check if passwords match
    if (password !== confirmPassword) {
      displayMessage('Passwords do not match!', signupMessage, 'error');
      return;
    }

    try {
      // Send a POST request to the server for signup
      const response = await fetch('/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName, lastName, email, password }),
      });

      const result = await response.json();
      if (response.ok) {
        // If signup is successful, display success message and switch to the login form
        displayMessage(result.message, signupMessage, 'success');
        signupForm.reset();
        setTimeout(() => {
          wrapper.classList.remove('active');
        }, 500);
      } else {
        // If signup fails, display the error message
        displayMessage(result.message, signupMessage, 'error');
      }
    } catch (error) {
      // Handle errors during signup process
      displayMessage('An error occurred during signup', signupMessage, 'error');
    }
  });

  // Event listener to switch to the registration form when register link is clicked
  registerLink.addEventListener('click', () => {
    wrapper.classList.add('active');
  });

  // Event listener to switch to the login form when login link is clicked
  loginLink.addEventListener('click', () => {
    wrapper.classList.remove('active');
  });

  // Event listener to show the popup when the login button is clicked
  btnPopup.addEventListener('click', () => {
    wrapper.classList.add('active-popup');
  });

});
