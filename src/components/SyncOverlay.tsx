import { Box, Button, CircularProgress, Icon, Text, VStack } from '@chakra-ui/react';
import { BiCheckCircle, BiErrorCircle } from 'react-icons/bi';
import { SyncFromRepoResult } from '../lib/syncFromRepo';

export type SyncStatus =
  | { state: 'idle' }
  | { state: 'running'; processed: number; total: number }
  | { state: 'done'; result: SyncFromRepoResult }
  | { state: 'error'; message: string };

interface SyncOverlayProps {
  status: SyncStatus;
  onClose: () => void;
  onReload: () => void;
}

const SyncOverlay: React.FC<SyncOverlayProps> = ({ status, onClose, onReload }) => {
  if (status.state === 'idle') return null;

  return (
    <Box
      position="absolute"
      top="0"
      left="0"
      right="0"
      bottom="0"
      borderRadius="lg"
      bg="whiteAlpha.950"
      backdropFilter="blur(4px)"
      zIndex={999999}
      display="flex"
      alignItems="center"
      justifyContent="center"
    >
      <VStack spacing={4} textAlign="center" px={8}>
        {status.state === 'running' ? (
          <>
            <CircularProgress isIndeterminate color="green.500" />
            <Text fontSize="sm" fontWeight="semibold">
              Syncing problems from your repo…
            </Text>
            {status.total > 0 ? (
              <Text fontSize="xs" color="gray.500">
                Reading {status.processed} of {status.total} problems
              </Text>
            ) : (
              <Text fontSize="xs" color="gray.500">
                Fetching your repository…
              </Text>
            )}
          </>
        ) : status.state === 'done' ? (
          <>
            <Icon as={BiCheckCircle} color="green.500" boxSize={10} />
            <Text fontSize="sm">
              Added {status.result.added} problems from your repo, {status.result.alreadyTracked}{' '}
              already tracked
              {status.result.failed ? `, ${status.result.failed} failed` : ''}.
            </Text>
            <Button size="sm" colorScheme="green" onClick={onReload}>
              Reload dashboard
            </Button>
          </>
        ) : (
          <>
            <Icon as={BiErrorCircle} color="red.500" boxSize={10} />
            <Text fontSize="sm">{status.message}</Text>
            <Button size="sm" variant="outline" onClick={onClose}>
              Close
            </Button>
          </>
        )}
      </VStack>
    </Box>
  );
};

export default SyncOverlay;
