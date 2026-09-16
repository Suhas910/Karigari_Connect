// src/components/ErrorRetryCard.tsx
import React from 'react';
import { View, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { Text, Button, Card } from 'react-native-paper';
import { colors, spacing } from '../theme';

interface ErrorRetryCardProps {
  errorText: string;
  onRetry?: () => void;
  retryLabel?: string;
  asCard?: boolean;
  style?: StyleProp<ViewStyle>;
}

export default function ErrorRetryCard({
  errorText,
  onRetry,
  retryLabel = 'Retry',
  asCard = false,
  style,
}: ErrorRetryCardProps) {
  if (asCard) {
    return (
      <Card style={[styles.card, style]}>
        <Card.Content>
          <Text style={styles.errorText}>{errorText}</Text>
          {onRetry && (
            <Button
              mode="contained"
              onPress={onRetry}
              buttonColor={colors.primary}
              style={styles.retryBtn}
            >
              {retryLabel}
            </Button>
          )}
        </Card.Content>
      </Card>
    );
  }

  return (
    <View style={[styles.centered, style]}>
      <Text style={styles.hint}>{errorText}</Text>
      {onRetry && (
        <Button
          mode="contained"
          onPress={onRetry}
          buttonColor={colors.primary}
          style={styles.retryBtn}
        >
          {retryLabel}
        </Button>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
    backgroundColor: colors.background,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    elevation: 0,
    marginBottom: spacing.md,
  },
  hint: {
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  errorText: {
    color: colors.error,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  retryBtn: {
    minHeight: spacing.tapTarget,
    justifyContent: 'center',
  },
});
