// src/store/authStore.ts
import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { UserRole } from '../types/contracts';

interface AuthState {
  isAuthenticated: boolean;
  role: UserRole | null;
  userId: string | null;
  isHydrated: boolean;
  setAuth: (token: string, role: UserRole, userId: string) => Promise<void>;
  logout: () => Promise<void>;
  initAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  role: null,
  userId: null,
  isHydrated: false,
  setAuth: async (token, role, userId) => {
    try {
      await SecureStore.setItemAsync('userToken', token);
      await SecureStore.setItemAsync('userRole', role);
      await SecureStore.setItemAsync('userId', userId);
    } catch (err) {
      console.error('Failed to persist auth to SecureStore', err);
    }
    set({ isAuthenticated: true, role, userId });
  },
  logout: async () => {
    try {
      await SecureStore.deleteItemAsync('userToken');
      await SecureStore.deleteItemAsync('userRole');
      await SecureStore.deleteItemAsync('userId');
    } catch (err) {
      console.error('Failed to clear auth from SecureStore', err);
    }
    set({ isAuthenticated: false, role: null, userId: null });
  },
  initAuth: async () => {
    try {
      const token = await SecureStore.getItemAsync('userToken');
      const role = (await SecureStore.getItemAsync('userRole')) as UserRole | null;
      const userId = await SecureStore.getItemAsync('userId');

      if (token && role && (role === 'artisan' || role === 'coordinator' || role === 'admin')) {
        set({ isAuthenticated: true, role, userId, isHydrated: true });
        return;
      }
    } catch (err) {
      console.error('Failed to restore auth from SecureStore', err);
    }
    set({ isAuthenticated: false, role: null, userId: null, isHydrated: true });
  },
}));