import React, { useState } from "react";
import { View, StyleSheet, TouchableOpacity } from "react-native";
import { Text, TextInput, Button, ActivityIndicator } from "react-native-paper";
import { useNavigation } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { signup } from "../../services/authApi";
import { useAuthStore } from "../../store/authStore";
import { UserRole } from "../../types/contracts";
import { colors, spacing, typography } from "../../theme";

export default function SignUpScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const setAuth = useAuthStore((s) => s.setAuth);

  const [username, setUsername] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("artisan");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isValidPhone = phoneNumber.trim().length >= 10;
  const isValidUsername = username.trim().length >= 3;
  const isValidPassword = password.length >= 6;
  const canSubmit = isValidPhone && isValidUsername && isValidPassword && !loading;

  async function handleSignup() {
    setErrorMsg(null);
    setLoading(true);
    try {
      const result = await signup({
        username: username.trim(),
        phoneNumber: phoneNumber.trim(),
        password,
        role,
      });
      await setAuth(result.token, result.role, result.userId);
    } catch (err: any) {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail;
      if (status === 400 && detail) {
        setErrorMsg(detail);
      } else {
        setErrorMsg(t("auth.signupFailed", "Sign up failed. Check your details and try again."));
      }
      // eslint-disable-next-line no-console
      console.error("[SignUpScreen] signup failed:", err?.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text variant="titleLarge" style={styles.title}>
        {t("auth.signupTitle", "Create your account")}
      </Text>

      <TextInput
        mode="outlined"
        label={t('signIn.username')}
        autoCapitalize="none"
        value={username}
        onChangeText={setUsername}
        style={styles.input}
      />

      <TextInput
        mode="outlined"
        label={t('signIn.phoneNumber')}
        keyboardType="phone-pad"
        value={phoneNumber}
        onChangeText={setPhoneNumber}
        style={styles.input}
      />

      <TextInput
        mode="outlined"
        label={t("auth.password", "Password")}
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        style={styles.input}
      />
      {password.length > 0 && !isValidPassword && (
        <Text variant="bodySmall" style={styles.hintText}>
          {t("auth.passwordHint", "At least 6 characters.")}
        </Text>
      )}

      <Text variant="bodyMedium" style={styles.roleLabel}>
        {t("auth.iAmA", "I am a")}
      </Text>
      <View style={styles.roleRow}>
        <TouchableOpacity
          style={[styles.roleChip, role === "artisan" && styles.roleChipSelected]}
          onPress={() => setRole("artisan")}
        >
          <Text style={[styles.roleChipText, role === "artisan" && styles.roleChipTextSelected]}>
            {t("auth.artisan", "Artisan")}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.roleChip, role === "coordinator" && styles.roleChipSelected]}
          onPress={() => setRole("coordinator")}
        >
          <Text
            style={[styles.roleChipText, role === "coordinator" && styles.roleChipTextSelected]}
          >
            {t("auth.coordinator", "Coordinator")}
          </Text>
        </TouchableOpacity>
      </View>

      {errorMsg && (
        <Text variant="bodySmall" style={styles.errorText}>
          {errorMsg}
        </Text>
      )}

      <Button
        mode="contained"
        onPress={handleSignup}
        disabled={!canSubmit}
        style={styles.cta}
        contentStyle={styles.ctaContent}
      >
        {loading ? <ActivityIndicator color="#fff" /> : t("auth.signUp", "Sign up")}
      </Button>

      <Button
        mode="text"
        onPress={() => {
          if (navigation.canGoBack()) {
            navigation.goBack();
          } else {
            navigation.navigate("Auth");
          }
        }}
      >
        {t("auth.haveAccount", "Already have an account? Sign in")}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.lg,
    justifyContent: "center",
  },
  title: {
    fontFamily: typography.heading,
    color: colors.text,
    marginBottom: spacing.lg,
  },
  input: {
    marginBottom: spacing.sm,
  },
  hintText: {
    color: colors.text,
    opacity: 0.6,
    marginBottom: spacing.sm,
  },
  roleLabel: {
    fontFamily: typography.body,
    color: colors.text,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  roleRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  roleChip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "#E0D5C7",
    backgroundColor: "#fff",
  },
  roleChipSelected: {
    backgroundColor: colors.secondary,
    borderColor: colors.secondary,
  },
  roleChipText: {
    fontFamily: typography.body,
    color: colors.text,
  },
  roleChipTextSelected: {
    color: "#fff",
  },
  errorText: {
    color: "#B00020",
    marginBottom: spacing.sm,
  },
  cta: {
    marginTop: spacing.md,
    borderRadius: 12,
    backgroundColor: colors.primary,
  },
  ctaContent: {
    minHeight: 48,
  },
});
