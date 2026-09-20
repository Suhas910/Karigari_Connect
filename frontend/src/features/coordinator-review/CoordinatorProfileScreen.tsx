// src/features/coordinator-review/CoordinatorProfileScreen.tsx
import React, { useState, useMemo } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  Alert,
  Modal,
} from 'react-native';
import { Text, Card, Button, TextInput, ActivityIndicator, Divider, Chip, IconButton } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { CoordinatorStackParamList } from '../../types/navigation';
import { service } from '../../services';
import { useAppTheme, spacing, type ColorPalette } from '../../theme';
import { SettingsRow } from '../profile/SettingsRow';

export default function CoordinatorProfileScreen() {
  const { colors, isDark } = useAppTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);
  const navigation = useNavigation<NativeStackNavigationProp<CoordinatorStackParamList>>();
  const queryClient = useQueryClient();

  const [editModalVisible, setEditModalVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Profile query
  const {
    data: profile,
    isLoading,
    isRefetching,
    refetch,
  } = useQuery({
    queryKey: ['coordinatorProfile'],
    queryFn: () => service.getArtisanProfile(),
    staleTime: 10000,
  });

  // Edit form state
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [jurisdiction, setJurisdiction] = useState('');
  const [idProofType, setIdProofType] = useState('ngo_card');
  const [idProofNumber, setIdProofNumber] = useState('');
  const [addressLine, setAddressLine] = useState('');
  const [city, setCity] = useState('');
  const [pincode, setPincode] = useState('');

  const openEditModal = () => {
    setFirstName(profile?.first_name || '');
    setLastName(profile?.last_name || '');
    setEmail(profile?.email || '');
    setJurisdiction(profile?.declared_zone || 'Karnataka & Uttar Pradesh Handloom Clusters');
    setIdProofType(profile?.id_proof_type || 'ngo_card');
    setIdProofNumber(profile?.id_proof_number || '');
    setAddressLine(profile?.business_address_line || '');
    setCity(profile?.city || '');
    setPincode(profile?.pincode || '');
    setEditModalVisible(true);
  };

  const handleSaveProfile = async () => {
    setSubmitting(true);
    try {
      await service.submitPersonalDetails({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        email: email.trim() || undefined,
      });

      await service.submitBusinessDetails({
        business_address_line: addressLine.trim() || undefined,
        city: city.trim() || undefined,
        pincode: pincode.trim() || undefined,
      });

      await queryClient.invalidateQueries({ queryKey: ['coordinatorProfile'] });
      setEditModalVisible(false);
      Alert.alert('Success', 'Coordinator profile updated successfully.');
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to update coordinator profile.');
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <View style={[styles.centered, { paddingTop: Math.max(insets.top, 16) }]}>
        <ActivityIndicator size="large" color={colors.secondary} />
        <Text style={styles.loadingText}>Loading coordinator profile...</Text>
      </View>
    );
  }

  const fullName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || 'Field Coordinator';
  const username = profile?.username || 'coord_demo';
  const phone = profile?.phone_number || '9876543211';
  const currentEmail = profile?.email || 'coord_demo@karigari.local';
  const currentJurisdiction = profile?.declared_zone || 'Karnataka & Uttar Pradesh Handloom Clusters';
  const currentIdType: string = (profile?.id_proof_type as string) || 'ngo_card';
  const currentIdNumber = profile?.id_proof_number || 'NGO-KA-2024-8891';
  const currentAddress = profile?.business_address_line || 'Karnataka State Handloom Complex, Priyadarshini Bhavan';
  const currentCity = profile?.city || 'Bengaluru';
  const currentPincode = profile?.pincode || '560053';

  return (
    <View style={[styles.screen, { paddingTop: Math.max(insets.top, 16) }]}>
      <ScrollView
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            colors={[colors.secondary]}
          />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <MaterialCommunityIcons name="arrow-left" size={22} color={colors.text} />
          </TouchableOpacity>
          <View style={styles.headerTitleContainer}>
            <Text style={styles.kicker}>PROFILE & CREDENTIALS</Text>
            <Text style={styles.title}>Coordinator Profile</Text>
          </View>
        </View>

        {/* Identity Card */}
        <Card style={styles.identityCard}>
          <Card.Content style={styles.identityContent}>
            <View style={styles.avatarCircle}>
              <MaterialCommunityIcons name="shield-account" size={36} color={colors.secondary} />
            </View>
            <View style={styles.identityDetails}>
              <View style={styles.nameRow}>
                <Text style={styles.fullName}>{fullName}</Text>
                <View style={styles.verifiedBadge}>
                  <MaterialCommunityIcons name="check-decagram" size={14} color={colors.successGreen} />
                  <Text style={styles.verifiedText}>Verified</Text>
                </View>
              </View>
              <Text style={styles.usernameText}>@{username}</Text>
              <View style={styles.roleTag}>
                <Text style={styles.roleTagText}>MoSJE Cluster Field Supervisor</Text>
              </View>
            </View>
          </Card.Content>
        </Card>

        {/* Jurisdiction & Coverage Card */}
        <Card style={styles.card}>
          <Card.Content>
            <View style={styles.cardHeaderRow}>
              <MaterialCommunityIcons name="map-marker-radius" size={20} color={colors.secondary} />
              <Text style={styles.cardSectionTitle}>Assigned Jurisdiction</Text>
            </View>
            <Text style={styles.jurisdictionName}>{currentJurisdiction}</Text>
            <Text style={styles.jurisdictionDesc}>
              Authorized to verify artisan statutory provenance claims (GI Tag, Natural Dye, Handloom weave) and conduct minimum wage rate compliance checks for marketplace export.
            </Text>
          </Card.Content>
        </Card>

        {/* Official Credentials & ID Proofs */}
        <Card style={styles.card}>
          <Card.Content>
            <View style={styles.cardHeaderRow}>
              <MaterialCommunityIcons name="card-account-details-outline" size={20} color={colors.secondary} />
              <Text style={styles.cardSectionTitle}>Official ID & Accreditation</Text>
            </View>
            <View style={styles.idRow}>
              <View style={styles.idTypeBadge}>
                <Text style={styles.idTypeText}>
                  {currentIdType === 'aadhaar'
                    ? 'Aadhaar Card'
                    : currentIdType === 'shg_card'
                    ? 'SHG Federation Card'
                    : 'NGO Field Officer Card'}
                </Text>
              </View>
              <Text style={styles.idNumberText}>{currentIdNumber}</Text>
            </View>
            <View style={styles.authNoteBox}>
              <MaterialCommunityIcons name="shield-lock-outline" size={14} color={colors.secondary} />
              <Text style={styles.authNoteText}>
                Official credential verified by Ministry field administration.
              </Text>
            </View>
          </Card.Content>
        </Card>

        {/* Contact Information Card */}
        <Card style={styles.card}>
          <Card.Content>
            <View style={styles.cardHeaderRow}>
              <MaterialCommunityIcons name="card-account-phone-outline" size={20} color={colors.secondary} />
              <Text style={styles.cardSectionTitle}>Contact & Cluster Office</Text>
            </View>

            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Phone</Text>
              <Text style={styles.infoValue}>+91 {phone}</Text>
            </View>
            <Divider style={styles.rowDivider} />

            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Email</Text>
              <Text style={styles.infoValue}>{currentEmail}</Text>
            </View>
            <Divider style={styles.rowDivider} />

            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Office Address</Text>
              <Text style={styles.infoValue}>{currentAddress}</Text>
            </View>
            <Divider style={styles.rowDivider} />

            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>District & Pincode</Text>
              <Text style={styles.infoValue}>{currentCity} · {currentPincode}</Text>
            </View>
          </Card.Content>
        </Card>
      </ScrollView>
    </View>
  );
}

function createStyles(colors: ColorPalette, isDark: boolean) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: colors.background,
    },
    container: {
      padding: spacing.md,
      paddingBottom: 100,
    },
    centered: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: colors.background,
    },
    loadingText: {
      marginTop: spacing.md,
      color: colors.textMuted,
      fontSize: 14,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.md,
    },
    backBtn: {
      padding: spacing.xs,
    },
    headerTitleContainer: {
      flex: 1,
      marginLeft: spacing.xs,
    },
    kicker: {
      fontSize: 10,
      fontWeight: '700',
      color: colors.secondary,
      letterSpacing: 1,
    },
    title: {
      fontSize: 20,
      fontWeight: '800',
      color: colors.text,
    },
    identityCard: {
      backgroundColor: colors.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: spacing.md,
    },
    identityContent: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: spacing.sm,
    },
    avatarCircle: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: colors.indigoLight,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: spacing.md,
    },
    identityDetails: {
      flex: 1,
    },
    nameRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
    },
    fullName: {
      fontSize: 18,
      fontWeight: '800',
      color: colors.text,
    },
    verifiedBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.successLight,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 8,
      gap: 2,
    },
    verifiedText: {
      fontSize: 10,
      fontWeight: '700',
      color: colors.successGreen,
    },
    usernameText: {
      fontSize: 13,
      color: colors.textMuted,
      marginTop: 2,
    },
    roleTag: {
      backgroundColor: colors.indigoLight,
      alignSelf: 'flex-start',
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 6,
      marginTop: 6,
    },
    roleTagText: {
      fontSize: 11,
      fontWeight: '600',
      color: colors.secondary,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: spacing.md,
    },
    cardHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      marginBottom: spacing.xs,
    },
    cardSectionTitle: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.text,
    },
    jurisdictionName: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.secondary,
      marginTop: 4,
    },
    jurisdictionDesc: {
      fontSize: 12,
      color: colors.textMuted,
      lineHeight: 18,
      marginTop: 4,
    },
    idRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 6,
    },
    idTypeBadge: {
      backgroundColor: colors.badgeNeutral,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 6,
    },
    idTypeText: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.text,
    },
    idNumberText: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.text,
    },
    authNoteBox: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.indigoLight,
      padding: spacing.xs,
      paddingHorizontal: spacing.sm,
      borderRadius: 6,
      marginTop: spacing.sm,
      gap: 6,
    },
    authNoteText: {
      fontSize: 11,
      color: colors.secondary,
      fontWeight: '500',
    },
    infoRow: {
      paddingVertical: spacing.xs,
    },
    infoLabel: {
      fontSize: 11,
      color: colors.textMuted,
      marginBottom: 2,
    },
    infoValue: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.text,
    },
    rowDivider: {
      marginVertical: spacing.xs,
      backgroundColor: colors.border,
    },
    settingsCard: {
      backgroundColor: colors.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'flex-end',
    },
    modalContent: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      maxHeight: '85%',
      padding: spacing.md,
    },
    modalHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: spacing.sm,
    },
    modalTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.text,
    },
    modalBody: {
      paddingBottom: spacing.md,
      gap: spacing.sm,
    },
    input: {
      backgroundColor: colors.surface,
    },
    inputRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    modalFooter: {
      flexDirection: 'row',
      gap: spacing.sm,
      paddingTop: spacing.sm,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    modalCancelBtn: {
      flex: 1,
      borderRadius: 8,
    },
    modalSaveBtn: {
      flex: 1,
      borderRadius: 8,
    },
  });
}
