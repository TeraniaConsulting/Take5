// auth.js - Terania Take 5 Safety PWA Local Profile Authentication

const auth = (() => {
  let currentUser = null;

  /**
   * Initialize local profile authentication
   */
  async function initialize() {
    const cachedUser = localStorage.getItem('terania_user_session');
    if (cachedUser) {
      try {
        currentUser = JSON.parse(cachedUser);
        return true;
      } catch (e) {
        localStorage.removeItem('terania_user_session');
      }
    }
    return false;
  }

  /**
   * Login/Save Operator profile details
   */
  function login(name, email, role) {
    if (!name || !email || !role) {
      throw new Error('Name, email, and role are required fields.');
    }

    // Extract initials for avatar
    const initials = name
      .split(' ')
      .map(part => part.charAt(0))
      .join('')
      .substring(0, 2)
      .toUpperCase();

    currentUser = {
      name: name.trim(),
      email: email.trim().toLowerCase(),
      avatarCode: initials || 'U',
      role: role
    };

    localStorage.setItem('terania_user_session', JSON.stringify(currentUser));
    return currentUser;
  }

  /**
   * Log out/Clear local operator profile
   */
  function logout() {
    localStorage.removeItem('terania_user_session');
    currentUser = null;
    window.location.reload();
  }

  function getCurrentUser() {
    return currentUser;
  }

  return {
    initialize,
    login,
    logout,
    getCurrentUser
  };
})();
