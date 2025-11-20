import { motion } from 'framer-motion';

export default function NumberBall({ number, isExtra = false, size = 'md', selected = false }) {
  const sizes = {
    sm: 'w-8 h-8 text-sm',
    md: 'w-12 h-12 text-base',
    lg: 'w-16 h-16 text-xl',
  };

  return (
    <motion.div
      
      initial={{ scale: 0, rotate: -180 }}
      animate={{ scale: 1, rotate: 0 }}
      whileHover={{ scale: 1.1 }}
      
      className={`${sizes[size]} rounded-full flex items-center justify-center font-bold shadow-lg ${
        isExtra
          ? selected 
            ? 'bg-gradient-to-br from-yellow-400 to-yellow-600 text-gray-900'
            : 'bg-gradient-to-br from-yellow-300 to-yellow-500 text-gray-800'
          : selected
            ? 'bg-gradient-to-br from-blue-500 to-blue-700 text-white'
            : 'bg-gradient-to-br from-blue-400 to-blue-600 text-white'
      }`}
    >
      {number}
    </motion.div>
  );
}