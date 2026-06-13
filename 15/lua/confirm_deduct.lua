local key = KEYS[1]
local quantity = tonumber(ARGV[1])

local current = tonumber(redis.call('GET', key) or '0')
if current < quantity then
    return -1
end

redis.call('DECRBY', key, quantity)
return current - quantity
