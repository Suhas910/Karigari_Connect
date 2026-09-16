// src/features/onboarding/SignInScreen.tsx
import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  ScrollView,
  Platform,
  Image,
} from 'react-native';
import { Text, Button, Card, TextInput, ActivityIndicator } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../store/authStore';
import { UserRole } from '../../types/contracts';
import { colors, spacing } from '../../theme';
import { service } from '../../services';
import { login as authLogin, signup as authSignup } from '../../services/authApi';

export default function SignInScreen() {
  const { t } = useTranslation();
  const setAuth = useAuthStore((state) => state.setAuth);

  // Active Role Selection ('artisan' | 'coordinator')
  const [selectedRole, setSelectedRole] = useState<UserRole>('artisan');

  // Mode: Sign In vs Sign Up
  const [isSignUp, setIsSignUp] = useState(false);

  // Form Fields
  const [identifier, setIdentifier] = useState(''); // Username or Phone Number for login
  const [username, setUsername] = useState(''); // For registration
  const [phoneNumber, setPhoneNumber] = useState(''); // For registration
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // State flags
  const [loading, setLoading] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isArtisan = selectedRole === 'artisan';
  const roleThemeColor = isArtisan ? colors.primary : colors.secondary;
  const roleLabel = isArtisan ? t('signIn.artisan') : t('signIn.coordinator');

  const canSubmitSignIn = identifier.trim().length > 0 && password.length > 0 && !loading;
  const canSubmitSignUp =
    username.trim().length >= 3 &&
    phoneNumber.trim().length >= 10 &&
    password.length >= 6 &&
    !loading;

  // --- Handlers ---
  const handleSignIn = async () => {
    setErrorMsg(null);
    setLoading(true);
    try {
      const result = await authLogin(identifier.trim(), password);
      await setAuth(result.token, result.role, result.userId);
    } catch (error: any) {
      const status = error?.response?.status;
      if (status === 401) {
        setErrorMsg(t('signIn.invalidCredentials'));
      } else {
        const msg = error?.response?.data?.detail || error?.response?.data?.error?.message || error?.message || t('signIn.signInFailed');
        setErrorMsg(msg);
      }
      console.error('[SignInScreen] sign-in error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async () => {
    setErrorMsg(null);
    setLoading(true);
    try {
      const result = await authSignup({
        username: username.trim(),
        phoneNumber: phoneNumber.trim(),
        password,
        role: selectedRole,
      });
      await setAuth(result.token, result.role, result.userId);
    } catch (error: any) {
      const status = error?.response?.status;
      const detail = error?.response?.data?.detail;
      if (status === 400 && detail) {
        setErrorMsg(detail);
      } else {
        const msg = error?.response?.data?.error?.message || error?.message || t('signIn.registrationFailed');
        setErrorMsg(msg);
      }
      console.error('[SignInScreen] sign-up error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDemoLogin = async () => {
    setErrorMsg(null);
    setDemoLoading(true);
    try {
      // One-tap demo auth against live FastAPI + Neon DB seeded accounts
      const result = await service.login(selectedRole);
      await setAuth(result.access_token, result.role, result.user_id);
    } catch (error: any) {
      console.error('[SignInScreen] demo login error:', error);
      const msg = error?.response?.data?.error?.message || error?.message || t('signIn.demoFailed');
      setErrorMsg(msg);
    } finally {
      setDemoLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* App Title Header */}
        <View style={styles.header}>
          <Image
            source={require('../../../assets/logo-mark.png')}
            style={styles.logo}
            resizeMode="contain"
            accessibilityLabel="Karigari Connect Logo"
          />
          <Text variant="headlineMedium" style={styles.title}>
            Karigari Connect
          </Text>
          <Text style={styles.subtitle}>
            {t('signIn.tagline')}
          </Text>
        </View>

        {/* Top-Middle Pill Tab Selector */}
        <View style={styles.pillContainer}>
          <TouchableOpacity
            style={[
              styles.pillSegment,
              isArtisan && { backgroundColor: colors.primary },
            ]}
            onPress={() => {
              setSelectedRole('artisan');
              setErrorMsg(null);
            }}
            activeOpacity={0.8}
            accessibilityRole="tab"
            accessibilityState={{ selected: isArtisan }}
          >
            <Text
              style={[
                styles.pillText,
                isArtisan && styles.pillTextActive,
              ]}
            >
              {t('signIn.artisan')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.pillSegment,
              !isArtisan && { backgroundColor: colors.secondary },
            ]}
            onPress={() => {
              setSelectedRole('coordinator');
              setErrorMsg(null);
            }}
            activeOpacity={0.8}
            accessibilityRole="tab"
            accessibilityState={{ selected: !isArtisan }}
          >
            <Text
              style={[
                styles.pillText,
                !isArtisan && styles.pillTextActive,
              ]}
            >
              {t('signIn.coordinator')}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Error Notice */}
        {errorMsg && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{errorMsg}</Text>
          </View>
        )}

        {/* Auth Form Card */}
        <Card style={styles.authCard}>
          <Card.Content>
            <Text variant="titleMedium" style={[styles.cardTitle, { color: roleThemeColor }]}>
              {isSignUp ? t('signIn.createAccountAs', { role: roleLabel }) : t('signIn.signInAs', { role: roleLabel })}
            </Text>
            <Text style={styles.cardSubtitle}>
              {isSignUp
                ? t('signIn.signUpSubtitle')
                : t('signIn.signInSubtitle')}
            </Text>

            {isSignUp ? (
              // --- Sign Up Fields ---
              <>
                <TextInput
                  mode="outlined"
                  label={t('signIn.username')}
                  placeholder={t('signIn.usernamePlaceholder')}
                  autoCapitalize="none"
                  value={username}
                  onChangeText={setUsername}
                  style={styles.input}
                  outlineColor={colors.border}
                  activeOutlineColor={roleThemeColor}
                />
                <TextInput
                  mode="outlined"
                  label={t('signIn.phoneNumber')}
                  placeholder={t('signIn.phonePlaceholder')}
                  keyboardType="phone-pad"
                  value={phoneNumber}
                  onChangeText={setPhoneNumber}
                  style={styles.input}
                  outlineColor={colors.border}
                  activeOutlineColor={roleThemeColor}
                />
                <TextInput
                  mode="outlined"
                  label={t('auth.password')}
                  placeholder={t('auth.passwordHint')}
                  secureTextEntry={!showPassword}
                  value={password}
                  onChangeText={setPassword}
                  style={styles.input}
                  outlineColor={colors.border}
                  activeOutlineColor={roleThemeColor}
                  right={
                    <TextInput.Icon
                      icon={showPassword ? 'eye-off' : 'eye'}
                      onPress={() => setShowPassword(!showPassword)}
                    />
                  }
                />
                <Button
                  mode="contained"
                  onPress={handleSignUp}
                  loading={loading}
                  disabled={!canSubmitSignUp}
                  buttonColor={roleThemeColor}
                  style={styles.primaryActionBtn}
                  labelStyle={styles.btnLabel}
                >
                  {t('signIn.createAccountAs', { role: roleLabel })}
                </Button>
              </>
            ) : (
              // --- Sign In Fields ---
              <>
                <TextInput
                  mode="outlined"
                  label={t('signIn.identifier')}
                  placeholder={t('signIn.identifierPlaceholder')}
                  autoCapitalize="none"
                  value={identifier}
                  onChangeText={setIdentifier}
                  style={styles.input}
                  outlineColor={colors.border}
                  activeOutlineColor={roleThemeColor}
                />
                <TextInput
                  mode="outlined"
                  label={t('auth.password')}
                  secureTextEntry={!showPassword}
                  value={password}
                  onChangeText={setPassword}
                  style={styles.input}
                  outlineColor={colors.border}
                  activeOutlineColor={roleThemeColor}
                  right={
                    <TextInput.Icon
                      icon={showPassword ? 'eye-off' : 'eye'}
                      onPress={() => setShowPassword(!showPassword)}
                    />
                  }
                />
                <Button
                  mode="contained"
                  onPress={handleSignIn}
                  loading={loading}
                  disabled={!canSubmitSignIn}
                  buttonColor={roleThemeColor}
                  style={styles.primaryActionBtn}
                  labelStyle={styles.btnLabel}
                >
                  {t('signIn.signInAs', { role: roleLabel })}
                </Button>
              </>
            )}

            {/* Inline Toggle: Sign In <-> Sign Up */}
            <TouchableOpacity
              onPress={() => {
                setIsSignUp(!isSignUp);
                setErrorMsg(null);
              }}
              style={styles.toggleRow}
            >
              <Text style={styles.toggleText}>
                {isSignUp ? t('signIn.haveAccountPrompt') : t('signIn.newUserPrompt')}{' '}
                <Text style={[styles.toggleHighlight, { color: roleThemeColor }]}>
                  {isSignUp ? t('signIn.signInLink') : t('signIn.signUpLink')}
                </Text>
              </Text>
            </TouchableOpacity>
          </Card.Content>
        </Card>

        {/* Demo Account Divider & Fast Demo Button */}
        <View style={styles.demoSection}>
          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>{t('signIn.orEvaluate')}</Text>
            <View style={styles.dividerLine} />
          </View>

          <Button
            mode="outlined"
            onPress={handleDemoLogin}
            loading={demoLoading}
            disabled={loading || demoLoading}
            textColor={roleThemeColor}
            style={[styles.demoBtn, { borderColor: roleThemeColor }]}
            icon="lightning-bolt"
          >
            {t('signIn.demoLogin', { role: roleLabel })}
          </Button>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xxl,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  logo: {
    width: 88,
    height: 88,
    marginBottom: spacing.sm,
  },
  title: {
    fontWeight: '800',
    color: colors.primary,
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 14,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  pillContainer: {
    flexDirection: 'row',
    alignSelf: 'center',
    backgroundColor: '#EFECE6',
    borderRadius: 30,
    padding: 4,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pillSegment: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textMuted,
  },
  pillTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  authCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    elevation: 2,
    marginBottom: spacing.lg,
  },
  cardTitle: {
    fontWeight: '700',
    fontSize: 18,
    marginBottom: 4,
  },
  cardSubtitle: {
    color: colors.textMuted,
    fontSize: 13,
    marginBottom: spacing.md,
  },
  input: {
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
  },
  primaryActionBtn: {
    marginTop: spacing.sm,
    borderRadius: 10,
    minHeight: 48,
    justifyContent: 'center',
  },
  btnLabel: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  toggleRow: {
    alignItems: 'center',
    marginTop: spacing.md,
    paddingVertical: spacing.xs,
  },
  toggleText: {
    fontSize: 14,
    color: colors.textMuted,
  },
  toggleHighlight: {
    fontWeight: '700',
  },
  demoSection: {
    alignItems: 'center',
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
    width: '100%',
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  dividerText: {
    marginHorizontal: spacing.sm,
    color: colors.textMuted,
    fontSize: 12,
  },
  demoBtn: {
    width: '100%',
    borderRadius: 10,
    borderWidth: 1.5,
    minHeight: 48,
    justifyContent: 'center',
  },
  errorContainer: {
    backgroundColor: '#FDEDEC',
    borderWidth: 1,
    borderColor: colors.error,
    borderRadius: 10,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  errorText: {
    color: colors.error,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
});